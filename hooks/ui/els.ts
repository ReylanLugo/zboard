import type { Elements } from 'claude-code'

import type { Board } from '../domain/types.ts'
import type { UiState } from '../runtime/ui-types.ts'

/** The element tables of the two surfaces zboard draws a full board on. */
export type Els = Elements['terminal'] | Elements['desktop']

export interface ViewProps {
  readonly board: Board
  readonly ui: UiState
  readonly now: number
  readonly columns: number
}
