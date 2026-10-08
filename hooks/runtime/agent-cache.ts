import type { DomainEvent, EventBody } from '../domain/events.ts'
import { apply } from '../domain/project.ts'
import type { Board } from '../domain/types.ts'
import type { PlanBoard } from '../plan/types.ts'
import type { Io } from './io.ts'
import { append, readBoard } from './log-store.ts'
import { readPlan } from './plan-store.ts'

// What zboard knows of its own agents, held outside the host so that a hook's
// `.catch` handler can read it where `$` is not lent (re-entry, where every `$`
// call rejects). The handlers are defense in depth: zboard spawns its agents
// inside a hook frame (runtime/frame.ts) so its hooks run for them. The cache is
// written in ordinary hook context (every board append, plan append and session
// start); decisions a handler makes that the board must record wait in
// `pending` until ordinary context appends them.

export interface AgentCache {
  /** The board as of the last ordinary-context write, with `pending` applied; undefined until loaded. */
  readonly board?: Board
  /** The session root, which repo-relative allowed files are resolved against. */
  readonly root?: string
  /** Plan agents zboard spawned, agentId → role, newest last (they stay after their run ends). */
  readonly planRoles: ReadonlyMap<string, string>
  /** Board events decided where `$` was not lent, waiting to be appended. */
  readonly pending: readonly EventBody[]
}

export const EMPTY_AGENT_CACHE: AgentCache = { planRoles: new Map(), pending: [] }

/** Plan agents remembered for hand-back recognition; older ones are long finished. */
export const PLAN_ROLES_CAP = 64

/** The one mutable cell a hooks module holds; every value it holds is immutable. */
export interface AgentCell {
  readonly get: () => AgentCache
  readonly set: (next: AgentCache) => void
}

export function agentCell(initial: AgentCache = EMPTY_AGENT_CACHE): AgentCell {
  let current = initial
  return { get: () => current, set: next => { current = next } }
}

const applyBody = (board: Board, body: EventBody): Board =>
  apply(board, { ...body, seq: 0, at: 0, changeId: board.changeId ?? '' } as DomainEvent)

/** A fresh board from ordinary context; events still pending stay applied on top. */
export const withBoard = (cache: AgentCache, board: Board): AgentCache =>
  ({ ...cache, board: cache.pending.reduce(applyBody, board) })

export const withRoot = (cache: AgentCache, root: string): AgentCache => ({ ...cache, root })

/** Remembers every plan agent the plan board shows running. */
export function withPlanAgents(cache: AgentCache, plan: PlanBoard): AgentCache {
  const running = Object.values(plan.changes).flatMap(rec => (rec.activeAgent === undefined ? [] : [rec.activeAgent]))
  const fresh = running.filter(agent => cache.planRoles.get(agent.agentId) !== agent.role)
  if (fresh.length === 0) return cache
  const entries = [...cache.planRoles.entries(), ...fresh.map(agent => [agent.agentId, agent.role] as const)]
  return { ...cache, planRoles: new Map(entries.slice(-PLAN_ROLES_CAP)) }
}

/** Queues events decided where `$` was not lent, applying them to the cached board at once. */
export const withPending = (cache: AgentCache, events: readonly EventBody[]): AgentCache =>
  events.length === 0
    ? cache
    : { ...cache, pending: [...cache.pending, ...events], board: cache.board === undefined ? undefined : events.reduce(applyBody, cache.board) }

/** Loads the board, the plan and the root (session start, reload). */
export async function refreshAgents(io: Io, cell: AgentCell): Promise<void> {
  const board = await readBoard(io)
  const plan = await readPlan(io)
  const root = await io.session.root()
  cell.set(withRoot(withPlanAgents(withBoard(cell.get(), board), plan), root))
}

/** Appends what handlers decided without `$`; ordinary context only. */
export async function flushPending(io: Io, cell: AgentCell): Promise<void> {
  const events = cell.get().pending
  if (events.length === 0) return
  cell.set({ ...cell.get(), pending: [] })
  try {
    await append(io, events)
  } catch (error) {
    // Put them back (the cached board already shows them) for the next ordinary hook.
    cell.set({ ...cell.get(), pending: [...events, ...cell.get().pending] })
    throw error
  }
}
