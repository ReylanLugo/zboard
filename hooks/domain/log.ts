import type { DomainEvent, EventBody } from './events.ts'
import { project } from './project.ts'
import type { Board } from './types.ts'

export interface LogState {
  readonly snapshot: Board | null
  readonly tail: readonly DomainEvent[]
  readonly seq: number
}

export const EMPTY_LOG: LogState = { snapshot: null, tail: [], seq: 0 }
export const SNAPSHOT_THRESHOLD = 500

export function appendEvents(
  state: LogState,
  bodies: readonly EventBody[],
  at: number,
  changeId: string,
  threshold: number = SNAPSHOT_THRESHOLD,
): { state: LogState; events: DomainEvent[] } {
  const events: DomainEvent[] = bodies.map((body, index) => ({ ...body, seq: state.seq + index + 1, at, changeId }))
  const tail = [...state.tail, ...events]
  const seq = state.seq + events.length
  if (tail.length < threshold) return { state: { ...state, tail, seq }, events }
  return { state: { snapshot: project(tail, state.snapshot ?? undefined), tail: [], seq }, events }
}

export const boardOf = (state: LogState): Board => project(state.tail, state.snapshot ?? undefined)
