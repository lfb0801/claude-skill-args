import { describe, expect, test } from 'claude-code/testing'

import { canonical, frontmatter, missing, parse, specOf, suggest, typingChoices, withChoice } from '../hooks/args'

const DEMO = `---
name: demo
arguments: [intensity, focus, target]
disable-model-invocation: true
metadata:
  args:
    intensity:
      question: How hard should it push?
      options:
        gentle: 🌱 Explore without much pressure
        balanced: 🧭 Challenge important assumptions
        ruthless: 🔥 Aggressively challenge every weakness
    focus:
      optional: true
      open: true
      options:
        scope: 🎯 Question what is in and what is out
        risks: Hunt for what could go wrong
        alternatives: "Look for simpler ways: fewer parts"
    target:
      question: What should be grilled?
---

Body`

const GRILLING = `---
name: grilling
description: Challenge an idea, proposal, or piece of existing work — yours or Claude's — through rounds of focused questions.
argument-hint: "[what to challenge]"
disable-model-invocation: true
---

# Grilling`

const spec = specOf(DEMO)!

const suggestAt = (text: string, cursor = text.length) => {
  const start = text.slice(0, cursor).search(/\S+$/)
  return suggest(spec, text, start, cursor, text.slice(start, cursor)).map(r => r.text)
}

describe('frontmatter', () => {
  test('reads nested maps, inline and block lists, quoted values', () => {
    const fm = frontmatter('---\na: [x, "y z"]\nb:\n  - one\n  - two\nc:\n  d: "e: f"\n  g: yes\n---\n')
    expect(fm).toEqual({ a: ['x', 'y z'], b: ['one', 'two'], c: { d: 'e: f', g: true } })
  })

  test('declares arguments in order with options, emoji and flags', () => {
    expect(spec.map(a => a.name)).toEqual(['intensity', 'focus', 'target'])
    expect(spec[0]!.options![0]).toEqual({ value: 'gentle', emoji: '🌱', description: 'Explore without much pressure' })
    expect(spec[1]!.options![1]).toEqual({ value: 'risks', emoji: undefined, description: 'Hunt for what could go wrong' })
    expect(spec[1]!.options![2]!.description).toBe('Look for simpler ways: fewer parts')
    expect(spec[1]).toEqual(expect.objectContaining({ optional: true, open: true, question: 'Which focus?' }))
    expect(spec[2]).toEqual({ name: 'target', question: 'What should be grilled?' })
  })

  test('leaves skills without declared options alone', () => {
    expect(specOf(GRILLING)).toBeUndefined()
    expect(specOf('no frontmatter at all')).toBeUndefined()
    expect(specOf(DEMO.replace('disable-model-invocation: true', 'disable-model-invocation: false'))).toBeUndefined()
    expect(specOf(DEMO.replace(/      options:\n(        .*\n)+/g, ''))).toBeUndefined()
  })

  test('refuses two free-text arguments', () => {
    expect(specOf(DEMO.replace('[intensity, focus, target]', '[intensity, focus, target, extra]'))).toBeUndefined()
  })
})

describe('parse', () => {
  test('takes values only from !words, anywhere, the rest is the target', () => {
    expect(parse(spec, 'my idea !scope !ruthless')).toEqual({ values: { focus: 'scope', intensity: 'ruthless' }, rest: 'my idea', invalid: {} })
    expect(parse(spec, 'ruthless my idea')).toEqual({ values: {}, rest: 'ruthless my idea', invalid: {} })
  })

  test('an unknown value fills an open argument first and is invalid for a strict one otherwise', () => {
    expect(parse(spec, 'my idea !strategy')).toEqual({ values: { focus: 'strategy' }, rest: 'my idea', invalid: {} })
    expect(parse(spec, 'my idea !scope !nope')).toEqual({ values: { focus: 'scope' }, rest: 'my idea', invalid: { intensity: 'nope' } })
    expect(parse(spec, '!ruthless my idea !security').values).toEqual({ intensity: 'ruthless', focus: 'security' })
    expect(parse(spec, '!security !ruthless idea').values).toEqual({ intensity: 'ruthless', focus: 'security' })
  })

  test('an unknown value with nowhere to go stays in the target', () => {
    expect(parse(spec, '!ruthless !scope !nope my idea').rest).toBe('!nope my idea')
    expect(parse(spec, 'say hello! to me').rest).toBe('say hello! to me')
  })

  test('asks only for unfilled required arguments', () => {
    expect(missing(spec, parse(spec, '')).map(a => a.name)).toEqual(['intensity', 'target'])
    expect(missing(spec, parse(spec, '!ruthless my idea')).map(a => a.name)).toEqual([])
    expect(missing(spec, parse(spec, '!ruthless')).map(a => a.name)).toEqual(['target'])
  })

  test('hands the skill quoted positional arguments', () => {
    expect(canonical(spec, parse(spec, 'my idea !scope !ruthless'))).toBe('ruthless scope "my idea"')
    expect(canonical(spec, parse(spec, '!gentle say "hi" to C:\\x'))).toBe('gentle "" "say \\"hi\\" to C:\\\\x"')
  })
})

describe('autocomplete', () => {
  test('offers the first argument right after the command', () => {
    expect(suggestAt('/demo')).toEqual(['/demo !gentle', '/demo !balanced', '/demo !ruthless'])
  })

  test('filters a partial !value across the arguments still open', () => {
    expect(suggestAt('/demo idea !r')).toEqual(['!ruthless', '!risks'])
    expect(suggestAt('/demo !ruthless idea !r')).toEqual(['!risks'])
    expect(suggestAt('/demo !strategy !')).toEqual(['!gentle', '!balanced', '!ruthless'])
  })

  test('chains to the next argument after a complete value', () => {
    expect(suggestAt('/demo !ruthless')).toEqual(['!ruthless !scope', '!ruthless !risks', '!ruthless !alternatives'])
    expect(suggestAt('/demo !ruthless !scope')).toEqual([])
  })

  test('leaves free text, mid-word cursors and other prompts alone', () => {
    expect(suggestAt('/demo r')).toEqual([])
    expect(suggestAt('/demo !ru tail', 8)).toEqual([])
    expect(suggestAt('/demo !ru tail', 9)).toEqual(['!ruthless'])
    expect(suggestAt('/demo !ruthless my idea !rx')).toEqual([])
    expect(suggest(spec, 'idea !r', 5, 7, '!r')).toEqual([])
  })
})

describe('typing band', () => {
  test('shows the next unset argument and inserts after the command', () => {
    const choices = typingChoices(spec, '/demo my idea', 13)!
    expect(choices.options.map(o => o.value)).toEqual(['gentle', 'balanced', 'ruthless'])
    expect(withChoice('/demo my idea', 13, choices.start, 'balanced')).toBe('/demo !balanced my idea')
  })

  test('narrows on a partial !value and replaces it', () => {
    const choices = typingChoices(spec, '/demo my idea !r', 16)!
    expect(choices.options.map(o => o.value)).toEqual(['ruthless', 'risks'])
    expect(withChoice('/demo my idea !r', 16, choices.start, 'risks')).toBe('/demo my idea !risks')
  })

  test('disappears once every argument is set', () => {
    expect(typingChoices(spec, '/demo !ruthless !scope my idea', 30)).toBeUndefined()
    expect(typingChoices(spec, 'hello', 5)).toBeUndefined()
  })
})
