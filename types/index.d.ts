/**
 * zboard's `$.state` contract. Claude Code requires it to be self-contained (no
 * imports), so values are declared structurally here; the module narrows them
 * to its domain types (`LogState`, `UiState`) at the `ioOf` boundary.
 */
export type ZboardLog = {
  readonly snapshot: unknown
  readonly tail: readonly unknown[]
  readonly seq: number
}

export type ZboardUi = {
  readonly view: 'kanban' | 'swimlane' | 'tree'
  readonly filter: { readonly kind: string; readonly value?: string }
  readonly selected: string | null
  readonly composing: string | null
  readonly detail: string | null
  readonly showArtifact: boolean
}

export type ZboardArtifacts = Readonly<Record<string, string>>

declare module 'claude-code' {
  interface PluginState {
    zboard: {
      log: ZboardLog
      ui: ZboardUi
      artifacts: ZboardArtifacts
    }
  }
}
