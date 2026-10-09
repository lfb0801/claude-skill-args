import type { ClientModule } from 'claude-code'

type Option = { value: string; emoji?: string; description: string }
type Props = { options: Option[]; isPlain?: boolean }
type State = { hover: number | null }

const GAP = 2
const MIN = 18
const MAX = 34

const linesOf = (text: string, width: number) => {
  const lines: string[] = []
  for (const word of text.split(' ')) {
    const last = lines[lines.length - 1]
    if (last !== undefined && last.length + 1 + word.length <= width) lines[lines.length - 1] = `${last} ${word}`
    else lines.push(word)
  }
  return lines.length
}

const Cards: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const options = props.options
  const n = options.length
  const fit = surface.columns > 0 ? Math.floor((surface.columns - GAP * (n - 1)) / n) : MAX
  const isRow = fit >= MIN
  const width = isRow ? Math.min(fit, MAX) : Math.max(MIN, surface.columns)
  const inner = width - 4
  const height = 3 + Math.max(...options.map(o => linesOf(o.description, inner)))
  const hover = surface.state?.hover ?? null

  const indexAt = (x: number, y: number) => {
    if (props.isPlain) return y >= 0 && y < n && x >= 0 ? y : null
    const step = isRow ? width + GAP : height + 1
    const along = isRow ? x : y
    const across = isRow ? y : x
    const i = Math.floor(along / step)
    const isInside = along >= 0 && along % step < (isRow ? width : height) && across >= 0 && across < (isRow ? height : width)
    return isInside && i < n ? i : null
  }

  surface.onPointer(e => {
    const i = e.type === 'leave' ? null : indexAt(e.x, e.y)
    if (e.type === 'down' && e.button === 'left' && i !== null) surface.post({ pick: options[i]!.value })
    if (i !== hover) surface.setState({ hover: i })
  })

  surface.onKey(e => {
    const current = hover ?? 0
    if (e.key === 'right' || e.key === 'down') surface.setState({ hover: (current + 1) % n })
    if (e.key === 'left' || e.key === 'up') surface.setState({ hover: (current - 1 + n) % n })
    if (e.key === 'return' && hover !== null) surface.post({ pick: options[hover]!.value })
  })

  if (props.isPlain) {
    const pad = Math.max(...options.map(o => o.value.length)) + 4
    return (
      <Box flexDirection="column">
        {options.map((o, i) => (
          <Box key={o.value}>
            <Text color={i === hover ? 'claude' : undefined}>{`!${o.value}`.padEnd(pad)}</Text>
            <Text dimColor wrap="truncate-end">
              {o.description}
            </Text>
          </Box>
        ))}
      </Box>
    )
  }

  return (
    <Box flexDirection={isRow ? 'row' : 'column'} columnGap={GAP} rowGap={1}>
      {options.map((o, i) => (
        <Box
          key={o.value}
          width={width}
          height={height}
          flexDirection="column"
          borderStyle="round"
          borderColor={i === hover ? 'claude' : 'subtle'}
          paddingX={1}
        >
          <Text bold={!props.isPlain && i === hover}>
            {o.emoji && !props.isPlain ? `${o.emoji} ${o.value}` : o.value}
          </Text>
          <Text dimColor wrap="wrap">
            {o.description}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

export default Cards
