import type { Io } from './io.ts'

import type { EventBody } from '../domain/events.ts'
import { normalizeInside } from '../domain/paths.ts'
import { runOf, taskOfAgent } from '../domain/project.ts'
import type { Board } from '../domain/types.ts'
import { READ_ONLY_PHASES } from '../domain/types.ts'
import { append, readBoard, recordModError } from './log-store.ts'

export const DENY_LIMIT = 3

export type GuardDecision =
  | { readonly kind: 'pass' }
  | { readonly kind: 'deny'; readonly reason: string; readonly events: readonly EventBody[] }

export function guardDecision(board: Board, agentId: string, placed: string | undefined, spelled: string): GuardDecision {
  const task = taskOfAgent(board, agentId)
  const run = task === undefined ? undefined : runOf(task, agentId)
  if (task === undefined || run === undefined || run.endedAt !== undefined) return { kind: 'pass' }
  if (READ_ONLY_PHASES.includes(run.phase)) {
    return { kind: 'deny', reason: `zboard: the ${run.phase} phase is read-only; ${spelled} was not changed.`, events: [] }
  }
  const allowed = run.phase === 'tdd' ? task.testFiles : [...task.allowedFiles, ...task.testFiles]
  if (placed !== undefined && allowed.includes(placed)) return { kind: 'pass' }
  const denied: EventBody = { type: 'GuardDenied', taskId: task.id, agentId, path: spelled }
  const escalate = run.denies + 1 >= DENY_LIMIT && task.status !== 'needs_decision'
  return {
    kind: 'deny',
    reason: `zboard: ${spelled} is outside this task's allowed files (${allowed.join(', ') || 'none'}).`,
    events: escalate
      ? [denied, { type: 'TaskStatusChanged', taskId: task.id, from: task.status, to: 'needs_decision', reason: 'plan too narrow' }]
      : [denied],
  }
}

async function realOf(io: Io, absolute: string): Promise<string | undefined> {
  let head = absolute
  let rest = ''
  while (head.length > 1) {
    const stat = await io.fs.stat(head, { resolve: true }).catch(() => undefined)
    if (stat?.realPath !== undefined) return `${stat.realPath.replace(/\/$/, '')}${rest}`
    const cut = head.lastIndexOf('/')
    if (cut <= 0) return undefined
    rest = `${head.slice(cut)}${rest}`
    head = head.slice(0, cut)
  }
  return undefined
}

/** Repo-relative path where `path` really lands, or undefined when it lands outside the resolved root. */
export async function placeInside(io: Io, path: string, root: string): Promise<string | undefined> {
  const lexical = normalizeInside(path, root)
  if (lexical === undefined) return undefined
  const realRoot = (await io.fs.stat(root, { resolve: true }).catch(() => undefined))?.realPath
  const real = await realOf(io, `${root}/${lexical}`)
  if (realRoot === undefined || real === undefined) return undefined
  return normalizeInside(real, realRoot)
}

async function check(io: Io, agentId: string | undefined, path: string): Promise<string | undefined> {
  if (agentId === undefined) return undefined
  const board = await readBoard(io)
  if (taskOfAgent(board, agentId) === undefined) return undefined
  const root = await io.session.root()
  const decision = guardDecision(board, agentId, await placeInside(io, path, root), path)
  if (decision.kind === 'pass') return undefined
  await append(io, decision.events)
  return decision.reason
}

/**
 * Decides one write by a pipeline agent: a denial reason, or undefined to let it through.
 * Fails closed: if the guard itself breaks, a pipeline agent's write is refused.
 */
export async function guardWrite(io: Io, agentId: string | undefined, path: string): Promise<string | undefined> {
  try {
    return await check(io, agentId, path)
  } catch (error) {
    await recordModError(io, 'guard', error)
    return agentId === undefined ? undefined : 'zboard: the allowed-file guard failed, so this write was refused.'
  }
}
