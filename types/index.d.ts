export type Probe = number

declare module 'claude-code' {
  interface PluginState {
    zboard: { probe: Probe }
  }
}
