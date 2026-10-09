import type { Arg, Option, Parsed } from '../types'

type Node = Record<string, unknown> | unknown[]

const scalar = (raw: string): unknown => {
  const value = raw.trim()
  if (/^\[.*\]$/.test(value)) return value.slice(1, -1).split(',').map(scalar).filter(v => v !== '')
  if (/^(["']).*\1$/.test(value)) return value.slice(1, -1)
  if (/^(true|yes|on)$/i.test(value)) return true
  if (/^(false|no|off)$/i.test(value)) return false
  return value
}

export const frontmatter = (source: string) => {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)?.[1] ?? ''
  const root: Record<string, unknown> = {}
  const stack: { indent: number; node: Node; owner?: Record<string, unknown>; key?: string }[] = [{ indent: -1, node: root }]
  for (const line of block.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const indent = line.search(/\S/)
    while (indent <= stack[stack.length - 1]!.indent) stack.pop()
    const top = stack[stack.length - 1]!
    const item = /^\s*-\s+(.*)$/.exec(line)
    if (item) {
      if (!Array.isArray(top.node) && top.owner && top.key && !Object.keys(top.node).length) top.owner[top.key] = top.node = []
      if (Array.isArray(top.node)) top.node.push(scalar(item[1]!))
      continue
    }
    const pair = /^\s*([^:\s][^:]*?):(?:\s+(.*))?$/.exec(line)
    if (!pair || Array.isArray(top.node)) continue
    const [, key, value] = pair
    if (value?.trim()) top.node[key!] = scalar(value)
    else {
      const child: Record<string, unknown> = {}
      top.node[key!] = child
      stack.push({ indent, node: child, owner: top.node, key: key! })
    }
  }
  return root
}

const EMOJI = /^(\p{Extended_Pictographic}\uFE0F?)\s*/u

const optionOf = (value: string, text: unknown): Option => {
  const description = typeof text === 'string' ? text : ''
  const emoji = EMOJI.exec(description)?.[1]
  return { value, emoji, description: emoji ? description.replace(EMOJI, '') : description }
}

const asMap = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined)

export const specOf = (source: string): Arg[] | undefined => {
  const fm = frontmatter(source)
  const declared = asMap(asMap(fm.metadata)?.args)
  if (fm['disable-model-invocation'] !== true || !declared) return undefined
  const names = Array.isArray(fm.arguments)
    ? fm.arguments.map(String)
    : typeof fm.arguments === 'string'
      ? fm.arguments.split(/\s+/)
      : Object.keys(declared)
  const spec = names.filter(Boolean).map((name): Arg => {
    const meta = asMap(declared[name]) ?? {}
    const options = Object.entries(asMap(meta.options) ?? {}).map(([value, text]) => optionOf(value, text))
    return {
      name,
      question: typeof meta.question === 'string' ? meta.question : options.length ? `Which ${name}?` : `What is the ${name}?`,
      ...(options.length ? { options } : {}),
      ...(meta.optional === true ? { optional: true as const } : {}),
      ...(meta.open === true ? { open: true as const } : {}),
    }
  })
  const isUsable = spec.some(a => a.options) && spec.filter(a => !a.options).length <= 1
  return isUsable ? spec : undefined
}

export const BANG = /(^|\s)!([\w-]+)(?=\s|$)/g

export const isPermitted = (arg: Arg, value: string) => arg.options!.some(o => o.value === value)

export const parse = (spec: Arg[], args: string): Parsed => {
  const values: Record<string, string> = {}
  const invalid: Record<string, string> = {}
  const bangs = [...args.matchAll(BANG)].map(m => m[2]!)
  const taken = new Set<number>()
  bangs.forEach((value, i) => {
    const arg = spec.find(a => a.options && !(a.name in values) && isPermitted(a, value))
    if (arg) (values[arg.name] = value), taken.add(i)
  })
  bangs.forEach((value, i) => {
    if (taken.has(i)) return
    const arg =
      spec.find(a => a.options && a.open && !(a.name in values)) ??
      spec.find(a => a.options && !(a.name in values) && !(a.name in invalid))
    if (!arg) return
    if (arg.open) values[arg.name] = value
    else invalid[arg.name] = value
    taken.add(i)
  })
  let index = -1
  const rest = args.replace(BANG, (whole: string, lead: string) => (taken.has(++index) ? lead : whole))
  return { values, rest: rest.replace(/\s+/g, ' ').trim(), invalid }
}

export const missing = (spec: Arg[], parsed: Parsed) =>
  spec.filter(a => !a.optional && (a.options ? !(a.name in parsed.values) : !parsed.rest))

// Claude Code splits skill arguments shell-style, but keeps backslashes inside double quotes,
// so a value with " or \ goes in single quotes, splicing each ' in as '"'"'.
const quote = (value: string) => {
  if (/^[^\s"'\\]+$/.test(value)) return value
  if (!/["\\]/.test(value)) return `"${value}"`
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

export const canonical = (spec: Arg[], parsed: Parsed) =>
  spec.map(a => quote(a.options ? parsed.values[a.name] ?? '' : parsed.rest)).join(' ')

export const banged = (spec: Arg[], parsed: Parsed) =>
  [...spec.filter(a => a.options && parsed.values[a.name]).map(a => `!${parsed.values[a.name]}`), parsed.rest].filter(Boolean).join(' ')

export const questionFor = (arg: Arg, parsed: Parsed) =>
  parsed.invalid[arg.name] ? `"${parsed.invalid[arg.name]}" is not a valid ${arg.name}. ${arg.question}` : arg.question

export const typedCommand = (text: string) => /^\/(\S+)(\s+|$)/.exec(text)

const rowsFor = (options: Option[], prefix: string) =>
  options.map(o => ({ text: `${prefix}!${o.value}`, label: `!${o.value}`, description: o.description }))

export const suggest = (spec: Arg[], text: string, start: number, cursor: number, token: string) => {
  const head = typedCommand(text)
  if (!head || /\S/.test(text[cursor] ?? '')) return []
  const isAtEnd = !text.slice(cursor).trim()
  const elsewhere = start === 0 ? '' : text.slice(head[0].length, start) + ' ' + text.slice(cursor)
  const filled = parse(spec, elsewhere).values
  const open = spec.filter(a => a.options && !(a.name in filled))
  if (start === 0) return isAtEnd && open[0] ? rowsFor(open[0].options!, `${token} `) : []
  if (!token.startsWith('!')) return []
  const completed = open.find(a => isPermitted(a, token.slice(1)))
  if (completed) {
    const next = open.find(a => a !== completed)
    return next && isAtEnd ? rowsFor(next.options!, `${token} `) : []
  }
  const prefix = token.slice(1).toLowerCase()
  return open.flatMap(a =>
    a.options!.filter(o => o.value.startsWith(prefix)).map(o => ({ text: `!${o.value}`, label: `!${o.value}`, description: o.description })),
  )
}

export const typingChoices = (spec: Arg[], text: string, cursor: number) => {
  const head = typedCommand(text)
  if (!head || cursor < head[1]!.length + 1) return undefined
  const from = text.slice(0, cursor).search(/!\S*$/)
  const start = from >= head[0].length && /^\s/.test(text[from - 1] ?? '') ? from : -1
  const token = start >= 0 ? text.slice(start + 1, cursor).toLowerCase() : ''
  const others = parse(spec, text.slice(head[0].length, start >= 0 ? start : cursor) + ' ' + text.slice(cursor)).values
  const open = spec.filter(a => a.options && !(a.name in others))
  const exact = open.find(a => isPermitted(a, token))
  if (start >= 0 && !exact) {
    const matching = open.filter(a => a.options!.some(o => o.value.startsWith(token)))
    const options = matching.flatMap(a => a.options!.filter(o => o.value.startsWith(token)))
    return matching[0] && { question: matching.length > 1 ? 'Which value?' : matching[0].question, options, start }
  }
  const arg = open.find(a => a !== exact)
  return arg && { question: arg.question, options: arg.options!, start: -1 }
}

export const withChoice = (text: string, cursor: number, start: number, value: string) => {
  if (start >= 0) return text.slice(0, start) + `!${value}` + text.slice(cursor)
  const head = typedCommand(text)!
  const rest = text.slice(head[0].length)
  return `/${head[1]} !${value} ${rest}`
}
