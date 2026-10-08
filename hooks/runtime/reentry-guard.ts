import type { EventBody } from '../domain/events.ts'
import { normalizeInside } from '../domain/paths.ts'
import { runOf, taskOfAgent } from '../domain/project.ts'
import type { AgentCache, AgentCell } from './agent-cache.ts'
import { withPending } from './agent-cache.ts'
import { guardDecision } from './guard.ts'

// The allowed-file guard's `.catch` handler: defense in depth, not the protection.
// zboard spawns its agents only inside a hook frame (runtime/frame.ts), so the
// engine runs the guard hook for their calls. Should a call still reach the
// handler (a throw, a timeout, or re-entry, where `$` rejects), it decides from
// the agent cache alone and fails closed. Live (2.1.294) the engine did not
// consult it for agents spawned outside a frame, so it cannot stand in for the
// frame rule. Paths are placed lexically (no symlink resolution without `$`).

/** The tools the guard gates; every other tool passes. */
export const GATED_TOOLS: readonly string[] = ['Edit', 'Write', 'NotebookEdit']

export const GUARD_FAILED = 'zboard: the allowed-file guard failed, so this write was refused.'

/** What a `.catch` handler's `next` carries (the engine's `Caught`), as these decisions read it. */
export interface CaughtNext {
  readonly error?: { readonly kind: string }
  readonly called: boolean
}

export interface WriteVerdict {
  readonly deny?: string
  readonly events: readonly EventBody[]
}

const PASS: WriteVerdict = { events: [] }
const denied = (reason: string): WriteVerdict => ({ deny: reason, events: [] })

/** The guard's answer for one write raised beneath zboard's own frame, from the cache alone. */
export function reentryWrite(cache: AgentCache, tool: string, agentId: string | undefined, path: string): WriteVerdict {
  if (!GATED_TOOLS.includes(tool) || agentId === undefined) return PASS
  const { board, root } = cache
  if (board === undefined || root === undefined) return denied(`zboard: the board is not loaded yet, so ${path} was not changed.`)
  if (cache.planRoles.has(agentId)) return denied(`zboard: plan agents are read-only; ${path} was not changed.`)
  const task = taskOfAgent(board, agentId)
  const run = task === undefined ? undefined : runOf(task, agentId)
  if (run === undefined || run.endedAt !== undefined) {
    return denied(`zboard: agent ${agentId} is not a running zboard agent and its writes bypass zboard's hooks, so ${path} was not changed.`)
  }
  const decision = guardDecision(board, agentId, normalizeInside(path, root), path)
  return decision.kind === 'pass' ? PASS : { deny: decision.reason, events: decision.events }
}

/**
 * The guard hook's `.catch` handler body: on re-entry the cached guard (its
 * escalation events queued for ordinary context); on a failure of the hook
 * itself, pass if it had already let the write through, otherwise refuse an
 * agent's write. Resolves the denial reason, or undefined to let it through.
 */
export function caughtWrite(cell: AgentCell, tool: string, agentId: string | undefined, path: string, next: CaughtNext): string | undefined {
  if (next.error?.kind !== 're-entry') return next.called || agentId === undefined ? undefined : GUARD_FAILED
  const verdict = reentryWrite(cell.get(), tool, agentId, path)
  cell.set(withPending(cell.get(), verdict.events))
  return verdict.deny
}
