/**
 * zboard's `$.state` contract. Claude Code requires it to be self-contained (no
 * imports), so values are declared structurally here; the module narrows them
 * to its domain types (`LogState`, `UiState`, `PlanLog`) at the `ioOf` boundary.
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
  readonly changes: {
    readonly selected: string | null
    readonly tab: string
    readonly artifact: string | null
    readonly composing: string | null
    readonly forecast: unknown
    readonly showRaw: boolean
    readonly initError: string | null
  }
}

export type ZboardArtifacts = Readonly<Record<string, string>>

export type ZboardPlan = {
  readonly snapshot: unknown
  readonly tail: readonly unknown[]
  readonly seq: number
}

/** Reports zboard agents handed back through SubagentHandback, each kept until its agent's stop takes it. */
export type ZboardHandbacks = readonly { readonly agentId: string; readonly message: string }[]

declare module 'claude-code' {
  interface PluginState {
    zboard: {
      log: ZboardLog
      ui: ZboardUi
      artifacts: ZboardArtifacts
      plan: ZboardPlan
      handbacks: ZboardHandbacks
    }
  }
}
