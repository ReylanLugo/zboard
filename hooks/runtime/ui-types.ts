import type { Role, TaskStatus } from '../domain/types.ts'

export type View = 'kanban' | 'swimlane' | 'tree'
export const VIEWS: readonly View[] = ['kanban', 'swimlane', 'tree']

export type Filter =
  | { readonly kind: 'none' }
  | { readonly kind: 'status'; readonly value: TaskStatus }
  | { readonly kind: 'agent'; readonly value: Role }
  | { readonly kind: 'section'; readonly value: string }

export interface UiState {
  readonly view: View
  readonly filter: Filter
  readonly selected: string | null
  readonly composing: string | null
  readonly detail: string | null
  readonly showArtifact: boolean
}

export const DEFAULT_UI: UiState = {
  view: 'kanban',
  filter: { kind: 'none' },
  selected: null,
  composing: null,
  detail: null,
  showArtifact: false,
}
