import type { On, RenderSurface } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

const DEMO = `---
name: demo
arguments: [intensity, focus, target]
disable-model-invocation: true
metadata:
  args:
    intensity:
      question: How hard should it push?
      options:
        gentle: Explore without much pressure
        balanced: Challenge important assumptions
        ruthless: Aggressively challenge every weakness
    focus:
      optional: true
      open: true
      options:
        scope: Question what is in and what is out
        risks: Hunt for what could go wrong
    target:
      question: What should be grilled?
---
`

const GRILLING = `---
name: grilling
argument-hint: "[what to challenge]"
disable-model-invocation: true
---
`

const FILES: Record<string, string> = {
  '/home/.claude/plugins/installed_plugins.json': JSON.stringify({ plugins: { 'fantamentos@local': [{ installPath: '/fm' }] } }),
  '/fm/skills/grilling/SKILL.md': GRILLING,
}

type World = { surface: RenderSurface; answers?: string[]; isDismissed?: true }

const typed = (command: string, args: string) => ({
  command,
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 100 },
})

const engine = (on: On, world: World) => {
  const ran: string[] = []
  const filled: string[] = []
  const asked: string[] = []
  const answers = [...(world.answers ?? [])]
  const read = (path: string) => (path.endsWith('/skills/demo/SKILL.md') ? DEMO : FILES[path])
  on('fs.exists', ($, e) => ({ value: read(e.path) !== undefined }))
  on('fs.read', ($, e) => {
    const text = read(e.path)
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('env.get', () => ({ value: '/home' }))
  on('session.surfaces', () => ({ value: [world.surface] }))
  on('command.list', () => ({
    value: [
      { name: 'skill-args:demo', description: '', source: 'plugin' as const },
      { name: 'fantamentos:grilling', description: '', source: 'plugin' as const },
    ],
  }))
  on('prompt.fill', ($, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, ($, e) => {
    const question = e.questions[0]!
    asked.push(question.question)
    if (world.isDismissed) return { deny: 'The user does not want to proceed.' }
    return { result: { questions: e.questions, answers: { [question.question]: answers.shift() ?? '' } } } as never
  })
  on('command.run', ($, e) => {
    ran.push(`${e.command} ${e.args}`)
    return { text: 'ran' }
  })
  return { ran, filled, asked }
}

describe('terminal', () => {
  test('runs a complete invocation with quoted named arguments', async ($, on) => {
    const world = engine(on, { surface: 'terminal' })
    await $.command.run(typed('skill-args:demo', 'my idea !scope !ruthless'))
    expect(world.ran).toEqual(['skill-args:demo ruthless scope "my idea"'])
    expect(world.asked).toEqual([])
  })

  test('asks for a missing required value in the dialog', async ($, on) => {
    const world = engine(on, { surface: 'terminal', answers: ['gentle — Explore without much pressure'] })
    await $.command.run(typed('skill-args:demo', 'my idea'))
    expect(world.asked).toEqual(['How hard should it push?'])
    expect(world.ran).toEqual(['skill-args:demo gentle "" "my idea"'])
  })

  test('asks again after an invalid value until a permitted one is chosen', async ($, on) => {
    const world = engine(on, { surface: 'terminal', answers: ['loud', 'balanced'] })
    await $.command.run(typed('skill-args:demo', 'my idea !scope !nope'))
    expect(world.asked).toEqual([
      '"nope" is not a valid intensity. How hard should it push?',
      '"loud" is not a valid intensity. How hard should it push?',
    ])
    expect(world.ran).toEqual(['skill-args:demo balanced scope "my idea"'])
  })

  test('dismissing the dialog cancels and puts the prompt back', async ($, on) => {
    const world = engine(on, { surface: 'terminal', isDismissed: true })
    const result = await $.command.run(typed('skill-args:demo', 'my idea'))
    expect(result.text).toContain('cancelled')
    expect(world.filled).toEqual(['/skill-args:demo my idea'])
    expect(world.ran).toEqual([])
  })

  test('a missing target refills the prompt instead of running', async ($, on) => {
    const world = engine(on, { surface: 'terminal' })
    await $.command.run(typed('skill-args:demo', '!ruthless'))
    expect(world.filled).toEqual(['/skill-args:demo !ruthless '])
    expect(world.ran).toEqual([])
  })
})

describe('desktop', () => {
  test('a missing value opens the cards band and a pick runs the skill', async ($, on) => {
    const world = engine(on, { surface: 'desktop' })
    const result = await $.command.run(typed('skill-args:demo', 'my idea !scope'))
    expect(result.text).toContain('above the prompt')
    expect(world.ran).toEqual([])
    const band = await $.ui.mount({
      plugin: 'skill-args',
      surface: 'desktop',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100 } as never,
    })
    expect((await band.find({ text: /How hard should it push\?/ }))).toBeDefined()
    await band.post({ pick: 'ruthless' }, { in: 'cards' })
    expect(world.ran).toEqual(['skill-args:demo ruthless scope "my idea"'])
  })
})

describe('other skills', () => {
  test('a skill without declared options runs untouched', async ($, on) => {
    const world = engine(on, { surface: 'terminal' })
    await $.command.run(typed('fantamentos:grilling', 'my idea !ruthless'))
    expect(world.ran).toEqual(['fantamentos:grilling my idea !ruthless'])
  })

  test('an unknown command runs untouched', async ($, on) => {
    const world = engine(on, { surface: 'desktop' })
    await $.command.run(typed('nothing-here', '!ruthless'))
    expect(world.ran).toEqual(['nothing-here !ruthless'])
  })
})
