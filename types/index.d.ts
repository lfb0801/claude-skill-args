export type Option = { value: string; emoji?: string; description: string }

export type Arg = { name: string; question: string; options?: Option[]; optional?: true; open?: true }

export type Parsed = { values: Record<string, string>; rest: string; invalid: Record<string, string> }

export type Pending = { command: string; spec: Arg[]; parsed: Parsed; asking: string } | null

export type Draft = { text: string; cursor: number } | null

declare module 'claude-code' {
  interface PluginState {
    'skill-args': { pending: Pending; draft: Draft }
  }
}
