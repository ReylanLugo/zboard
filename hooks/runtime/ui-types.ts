import type { Role, TaskStatus } from '../domain/types.ts'
import type { Forecast } from '../plan/types.ts'

export type View = 'kanban' | 'swimlane' | 'tree'
export const VIEWS: readonly View[] = ['kanban', 'swimlane', 'tree']

export type Filter =
  | { readonly kind: 'none' }
  | { readonly kind: 'status'; readonly value: TaskStatus }
  | { readonly kind: 'agent'; readonly value: Role }
  | { readonly kind: 'section'; readonly value: string }

export type ChangesTab = 'summary' | 'diagrams' | 'specs' | 'tasks' | 'verify' | 'history'
export const CHANGES_TABS: readonly ChangesTab[] = ['summary', 'diagrams', 'specs', 'tasks', 'verify', 'history']
export type ComposeKind = 'new' | 'comment' | 'note'

/** Transient state of the changes viewer pane; `closeChanges` clears `composing`, `forecast`, `showRaw` and `initError`. */
export interface ChangesUi {
  readonly selected: string | null
  readonly tab: ChangesTab
  readonly artifact: string | null
  readonly composing: ComposeKind | null
  readonly forecast: Forecast | null
  /** `?` shows the raw CLI output behind each readable error line. */
  readonly showRaw: boolean
  /** The raw output of the last failed `openspec init`, until it succeeds or the pane closes. */
  readonly initError: string | null
}

export const DEFAULT_CHANGES_UI: ChangesUi = { selected: null, tab: 'summary', artifact: null, composing: null, forecast: null, showRaw: false, initError: null }

export interface UiState {
  readonly view: View
  readonly filter: Filter
  readonly selected: string | null
  readonly composing: string | null
  readonly detail: string | null
  readonly showArtifact: boolean
  readonly changes: ChangesUi
}

export const DEFAULT_UI: UiState = {
  view: 'kanban',
  filter: { kind: 'none' },
  selected: null,
  composing: null,
  detail: null,
  showArtifact: false,
  changes: DEFAULT_CHANGES_UI,
}
