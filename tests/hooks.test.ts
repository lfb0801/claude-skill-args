import type { On, RenderSurface } from 'claude-code'
import type { EngineCall } from 'claude-code/testing'
import { describe, expect, mock, test } from 'claude-code/testing'

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
  const submitted: string[] = []
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
  on('prompt.submit', ($, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  on('prompt.edit', ($, e) => ({ text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }))
  on('prompt.autocomplete', () => ({ suggestions: [] }))
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
  return { ran, filled, asked, submitted }
}

describe('terminal', () => {
  test('runs a complete invocation with quoted named arguments', async ($, on) => {
    const world = engine(on, { surface: 'terminal' })
    await $.command.run(typed('skill-args:demo', 'my idea $scope $ruthless'))
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
    await $.command.run(typed('skill-args:demo', 'my idea $scope $nope'))
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
    await $.command.run(typed('skill-args:demo', '$ruthless'))
    expect(world.filled).toEqual(['/skill-args:demo $ruthless '])
    expect(world.ran).toEqual([])
  })
})

describe('desktop', () => {
  test('shows the typing banner for an inline skill and inserts a choice in place', async ($, on) => {
    const world = engine(on, { surface: 'desktop' })
    const text = 'Please /demo the onboarding redesign'
    // These engine events exist in 2.1.293's test runner but are absent from
    // its generated Engine.prompt type.
    await ($.prompt as typeof $.prompt & { edit: EngineCall<'prompt.edit'> }).edit({ text: '', cursor: 0, start: 0, end: 0, inputText: text, origin: { kind: 'composer' } })
    const band = await $.ui.mount({
      plugin: 'skill-args', surface: 'desktop', component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100 } as never,
    })
    expect(await band.find({ text: /How hard should it push\?/ })).toBeDefined()
    expect(await band.find({ text: /type \$gentle/ })).toBeDefined()
    await band.post({ pick: 'ruthless' }, { in: 'typing' })
    expect(world.filled).toEqual(['Please /demo $ruthless the onboarding redesign'])
    expect(world.ran).toEqual([])
  })

  test('blocks inline submission until required arguments are picked', async ($, on) => {
    const world = engine(on, { surface: 'desktop' })
    const result = await $.prompt.submit({ text: 'Please /demo the onboarding redesign', origin: { kind: 'composer' }, wait: false })
    expect(result.drop).toContain('above the prompt')
    expect(world.submitted).toEqual([])
    expect(world.ran).toEqual([])
    const band = await $.ui.mount({
      plugin: 'skill-args', surface: 'desktop', component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100 } as never,
    })
    await band.post({ pick: 'ruthless' }, { in: 'cards' })
    expect(world.ran).toEqual(['skill-args:demo ruthless "" "Please the onboarding redesign"'])
  })

  test('parses choices anywhere and schedules a complete inline skill exactly once', async ($, on) => {
    const clock = mock.clock(on)
    const world = engine(on, { surface: 'desktop' })
    const result = await $.prompt.submit({
      text: '$ruthless Please /demo the onboarding redesign and focus on $scope', origin: { kind: 'composer' }, wait: false,
    })
    expect(result.drop).toContain('running')
    expect(world.submitted).toEqual([])
    await clock.settle()
    expect(world.ran).toEqual(['skill-args:demo ruthless scope "Please the onboarding redesign and focus on"'])
  })

  test('an explicit focus still blocks on the missing intensity, rather than taking it from prose', async ($, on) => {
    const world = engine(on, { surface: 'desktop' })
    const result = await $.prompt.submit({
      text: 'Please be ruthless /demo the onboarding redesign and focus on $scope', origin: { kind: 'composer' }, wait: false,
    })
    expect(result.drop).toContain('above the prompt')
    expect(world.ran).toEqual([])
    const band = await $.ui.mount({
      plugin: 'skill-args', surface: 'desktop', component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100 } as never,
    })
    expect(await band.find({ text: /How hard should it push\?/ })).toBeDefined()
    await band.post({ pick: 'gentle' }, { in: 'cards' })
    expect(world.ran).toEqual(['skill-args:demo gentle scope "Please be ruthless the onboarding redesign and focus on"'])
  })

  test('a missing value opens the cards band and a pick runs the skill', async ($, on) => {
    const world = engine(on, { surface: 'desktop' })
    const result = await $.command.run(typed('skill-args:demo', 'my idea $scope'))
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

describe('inline terminal skills', () => {
  test('the compact typing list displays dollar-prefixed choices', async ($, on) => {
    engine(on, { surface: 'terminal' })
    const text = '/demo the redesign'
    await ($.prompt as typeof $.prompt & { edit: EngineCall<'prompt.edit'> }).edit({ text: '', cursor: 0, start: 0, end: 0, inputText: text, origin: { kind: 'composer' } })
    const band = await $.ui.mount({
      plugin: 'skill-args', surface: 'terminal', component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100 } as never,
    })
    expect(await band.find({ text: /\$gentle/, in: 'typing' })).toBeDefined()
  })

  test('asks for a required choice before running an inline skill', async ($, on) => {
    const clock = mock.clock(on)
    const world = engine(on, { surface: 'terminal', answers: ['gentle'] })
    await $.prompt.submit({ text: 'Please /demo the redesign $scope', origin: { kind: 'composer' }, wait: false })
    expect(world.asked).toEqual(['How hard should it push?'])
    expect(world.submitted).toEqual([])
    await clock.settle()
    expect(world.ran).toEqual(['skill-args:demo gentle scope "Please the redesign"'])
  })

  test('cancelling restores the original inline prompt and runs nothing', async ($, on) => {
    const world = engine(on, { surface: 'terminal', isDismissed: true })
    const text = 'Please /demo the redesign'
    const result = await $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false })
    expect(result.drop).toContain('cancelled')
    expect(world.filled).toEqual([text])
    expect(world.ran).toEqual([])
    expect(world.submitted).toEqual([])
  })

  test('a missing free-text target is refilled rather than submitted', async ($, on) => {
    const world = engine(on, { surface: 'terminal' })
    const result = await $.prompt.submit({ text: '$ruthless /demo', origin: { kind: 'composer' }, wait: false })
    expect(result.drop).toContain('What should be grilled?')
    expect(world.filled).toEqual(['/skill-args:demo $ruthless '])
    expect(world.submitted).toEqual([])
    expect(world.ran).toEqual([])
  })
})

describe('other skills', () => {
  test('leaves unrelated prompts, leading commands and plugin messages untouched', async ($, on) => {
    const world = engine(on, { surface: 'desktop' })
    for (const text of ['Please /nothing-here review this', 'Please /grilling review this', '/demo $ruthless my idea', 'See /tmp/file']) {
      await $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false })
    }
    await $.prompt.submit({ text: 'Please /demo my idea', origin: { kind: 'plugin', name: 'another-plugin' }, wait: false })
    expect(world.submitted).toEqual(['Please /nothing-here review this', 'Please /grilling review this', '/demo $ruthless my idea', 'See /tmp/file', 'Please /demo my idea'])
    expect(world.ran).toEqual([])
  })

  test('resolves a configured skill after an unknown slash token for autocomplete', async ($, on) => {
    engine(on, { surface: 'terminal' })
    const text = 'See /unknown then /demo the redesign $r'
    const result = await ($.prompt as typeof $.prompt & { autocomplete: EngineCall<'prompt.autocomplete'> }).autocomplete({ text, cursor: text.length, start: text.length - 2, token: '$r' })
    expect(result.suggestions.map(row => row.text)).toEqual(['$ruthless', '$risks'])
  })

  test('a skill without declared options runs untouched', async ($, on) => {
    const world = engine(on, { surface: 'terminal' })
    await $.command.run(typed('fantamentos:grilling', 'my idea $ruthless'))
    expect(world.ran).toEqual(['fantamentos:grilling my idea $ruthless'])
  })

  test('an unknown command runs untouched', async ($, on) => {
    const world = engine(on, { surface: 'desktop' })
    await $.command.run(typed('nothing-here', '$ruthless'))
    expect(world.ran).toEqual(['nothing-here $ruthless'])
  })
})
