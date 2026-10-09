import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Arg, Draft, Parsed, Pending } from '../types'
import { banged, canonical, isPermitted, missing, parse, questionFor, specOf, suggest, typedCommand, typingChoices, withChoice } from './args'

const pending = atom({ plugin: 'skill-args', key: 'pending' } as const, null as Pending)
const draft = atom({ plugin: 'skill-args', key: 'draft' } as const, null as Draft)

const specs = new Map<string, Arg[] | undefined>()
let commands: string[] | undefined

const candidates = async ($: EngineInterface, command: string) => {
  const [namespace, name] = command.includes(':') ? command.split(':', 2) : [undefined, command]
  if (namespace === $.plugin.name) return [`${$.plugin.root}/skills/${name}/SKILL.md`]
  if (namespace) {
    const home = await $.env.get('HOME')
    const installed = JSON.parse(await $.fs.read(`${home}/.claude/plugins/installed_plugins.json`).catch(() => '{}'))
    const entries = Object.entries((installed.plugins ?? {}) as Record<string, { installPath?: string }[]>)
    return entries
      .filter(([key]) => key.startsWith(`${namespace}@`))
      .flatMap(([, list]) => list.map(entry => `${entry.installPath}/skills/${name}/SKILL.md`))
  }
  const home = await $.env.get('HOME')
  return [`.claude/skills/${name}/SKILL.md`, `${home}/.claude/skills/${name}/SKILL.md`]
}

const specFor = async ($: EngineInterface, command: string, isFresh = false) => {
  if (!isFresh && specs.has(command)) return specs.get(command)
  let spec: Arg[] | undefined
  for (const path of await candidates($, command)) {
    if (!(await $.fs.exists(path))) continue
    spec = specOf(await $.fs.read(path))
    break
  }
  specs.set(command, spec)
  return spec
}

const resolve = async ($: EngineInterface, typed: string) => {
  commands ??= (await $.command.list()).map(c => c.name)
  return commands.find(name => name === typed) ?? commands.find(name => name.endsWith(`:${typed}`))
}

const choicesFor = async ($: EngineInterface, box: Draft, isMenuShown = false) => {
  const command = box ? await resolve($, typedCommand(box.text)?.[1] ?? '') : undefined
  const spec = command ? await specFor($, command) : undefined
  if (!box || !spec) return undefined
  if (isMenuShown) {
    const start = box.text.slice(0, box.cursor).search(/\S+$/)
    if (start >= 0 && suggest(spec, box.text, start, box.cursor, box.text.slice(start, box.cursor)).length) return undefined
  }
  return typingChoices(spec, box.text, box.cursor)
}

const ask = async ($: EngineInterface, arg: Arg, parsed: Parsed) => {
  const labels = arg.options!.map(o => `${o.value} — ${o.description}`)
  let question = questionFor(arg, parsed)
  for (;;) {
    const answer = await $.ui.ask(question, { options: labels, header: arg.name.slice(0, 12) })
    const option = arg.options!.find((o, i) => labels[i] === answer || o.value === answer.trim().toLowerCase())
    if (option) return option.value
    question = `"${answer.trim()}" is not a valid ${arg.name}. ${arg.question}`
  }
}

const settle = async ($: EngineInterface, command: string, spec: Arg[], parsed: Parsed) => {
  const next = missing(spec, parsed)[0]
  if (next && !next.options) {
    const filled = await $.prompt.fill({ text: `/${command} ${banged(spec, parsed)} ` })
    if (filled.isFilled) {
      await update($, pending, () => null)
      return `/${command}: ${next.question} Type it after the command and press Enter.`
    }
  }
  if (next) {
    await update($, pending, () => ({ command, spec, parsed, asking: next.name }))
    return `/${command}: finish the arguments above the prompt.`
  }
  await update($, pending, () => null)
  await $.command.run({ command, args: canonical(spec, parsed) })
  return ''
}

const isTerminal = async ($: EngineInterface) => (await $.session.surfaces()).every(s => s === 'terminal')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    $.clock.every(500, async () => {
      const box = await $.prompt.read()
      const known = await read($, draft)
      if (box.text !== (known?.text ?? '')) await update($, draft, () => box)
    })
    return next(e)
  })

  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    await update($, draft, () => ({ text: box.text, cursor: box.cursor }))
    return box
  })

  on('command.run', async ($, e, next) => {
    if (e.origin.kind === 'plugin' && e.origin.name === $.plugin.name) return next(e)
    commands = undefined
    const spec = await specFor($, e.command, true)
    if (!spec) return next(e)
    const parsed = parse(spec, e.args)

    if (await isTerminal($)) {
      for (const arg of missing(spec, parsed).filter(a => a.options)) {
        try {
          parsed.values[arg.name] = await ask($, arg, parsed)
        } catch {
          await $.prompt.fill({ text: `/${e.command} ${e.args}` })
          return { text: `/${e.command}: cancelled; your prompt is back in the box.` }
        }
      }
      if (missing(spec, parsed).length) {
        await $.prompt.fill({ text: `/${e.command} ${banged(spec, parsed)} ` })
        return { text: `/${e.command}: ${missing(spec, parsed)[0]!.question} Type it after the command and press Enter.` }
      }
      return next({ ...e, args: canonical(spec, parsed) })
    }

    if (!missing(spec, parsed).length) return next({ ...e, args: canonical(spec, parsed) })
    return { text: await settle($, e.command, spec, parsed) }
  }).catch(($, e, next) => {
    if (next.called || !specs.get(e.command)) return next(e)
    return { text: `/${e.command}: the argument check failed; nothing ran.` }
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, pending, () => null)
    await update($, draft, () => null)
    return next(e)
  })

  on('ui.message', { element: 'typing' }, async ($, e, next) => {
    const box = await read($, draft)
    const value = (e.data as { pick?: string } | null)?.pick
    const choices = await choicesFor($, box)
    if (!box || !value || !choices?.options.some(o => o.value === value)) return next(e)
    const text = withChoice(box.text, box.cursor, choices.start, value)
    await $.prompt.fill({ text })
    await update($, draft, () => ({ text, cursor: text.length }))
    return {}
  })

  on('ui.message', { element: 'cards' }, async ($, e, next) => {
    const current = await read($, pending)
    const value = (e.data as { pick?: string } | null)?.pick
    const arg = current?.spec.find(a => a.name === current.asking)
    if (!current || !value || !arg?.options || !isPermitted(arg, value)) return next(e)
    await settle($, current.command, current.spec, { ...current.parsed, values: { ...current.parsed.values, [arg.name]: value } })
    return {}
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, pending)
    const arg = current?.spec.find(a => a.name === current.asking)
    const ui = $.ui.resolve(e)
    if (e.props.hasSurvey || !('Client' in ui)) return next(e)
    const isPlain = e.surface === 'terminal'
    if (!current || !arg || isPlain) {
      const choices = await choicesFor($, await read($, draft), isPlain)
      if (!choices) return next(e)
      if (isPlain) {
        return <ui.Client key="typing" module="./cards.tsx" props={{ options: choices.options, isPlain }} width="100%" />
      }
      return (
        <ui.Box flexDirection="column" gap={1}>
          <ui.Text dimColor>
            {choices.question} Click to add it, or type !{choices.options[0]!.value}.
          </ui.Text>
          <ui.Client key="typing" module="./cards.tsx" props={{ options: choices.options }} width="100%" />
        </ui.Box>
      )
    }

    const { Box, Button, Text } = ui
    const chosen = banged(current.spec, { ...current.parsed, rest: '' })

    return (
      <Box flexDirection="column" gap={1}>
        <Box justifyContent="space-between">
          <Text>
            <Text bold>
              /{current.command}
              {chosen ? ` ${chosen}` : ''}
            </Text>
            {arg.options ? <Text> · {questionFor(arg, current.parsed)}</Text> : null}
          </Text>
          <Button key="cancel" role="dismiss" dimColor label="Cancel" onPress={() => update($, pending, () => null)} />
        </Box>
        {arg.options ? (
          <ui.Client key="cards" module="./cards.tsx" props={{ options: arg.options }} width="100%" />
        ) : (
          <Box width="100%">
            <ui.Input
              key="text"
              placeholder={arg.question}
              autoFocus
              onSubmit={(value: string) =>
                value.trim() ? settle($, current.command, current.spec, { ...current.parsed, rest: value.trim() }) : undefined
              }
            />
          </Box>
        )}
      </Box>
    )
  })

  on('prompt.autocomplete', async ($, e, next) => {
    const rest = (await next(e)).suggestions
    const typed = typedCommand(e.text)?.[1]
    const command = typed && (await resolve($, typed))
    const spec = command && (await specFor($, command))
    const rows = spec ? suggest(spec, e.text, e.start, e.cursor, e.token) : []
    return { suggestions: rows.length ? [...rest, ...rows] : rest }
  })
}
