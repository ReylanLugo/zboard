import type { EventBody } from '../domain/events.ts'
import type { AgentCache, AgentCell } from './agent-cache.ts'
import { withPending } from './agent-cache.ts'
import type { CaughtNext } from './reentry-guard.ts'
import { noteFor } from './inject.ts'

// Comment delivery from the tool.call hook's `.catch` handler: defense in depth.
// zboard's agents are spawned inside a hook frame (runtime/frame.ts), so the hook
// itself delivers; should a call reach the handler instead (re-entry, where `$`
// rejects), it delivers from the agent cache alone. Live, the engine did not
// consult it for agents spawned outside a frame. Its CommentDelivered events wait
// in the cache for ordinary context.

export interface FoundNote {
  readonly note: string
  readonly events: readonly EventBody[]
}

/** The comments waiting for a running board agent, when this call rose beneath zboard's own frame. */
export function reentryNote(cache: AgentCache, agentId: string | undefined, next: CaughtNext): FoundNote | undefined {
  if (next.error?.kind !== 're-entry' || agentId === undefined || cache.board === undefined) return undefined
  return noteFor(cache.board, agentId)
}

/** Appends the note to a tool result that was not denied and queues its delivery. */
export function deliverNote<R extends { readonly deny?: string; readonly context?: readonly string[] }>(
  cell: AgentCell,
  found: FoundNote | undefined,
  ran: R,
): R {
  if (found === undefined || ran.deny !== undefined) return ran
  cell.set(withPending(cell.get(), found.events))
  return { ...ran, context: [...(ran.context ?? []), found.note] }
}
