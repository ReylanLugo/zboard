import type { Io } from './io.ts'

import { fetchTopic, projectOf } from '../adapters/engram.ts'
import { isRecord } from '../domain/json.ts'
import type { PlanEventBody } from '../plan/plan-events.ts'
import type { CritiqueFinding, QaSession, Revision, VerifyRun } from '../plan/types.ts'
import { planTopic } from './plan-mirror.ts'
import { appendPlan, readPlan } from './plan-store.ts'

type Restored = Omit<Extract<PlanEventBody, { type: 'PlanRestored' }>, 'type' | 'changeId'>

/** D4: an active agent the engine no longer lists is interrupted; plan agents are never relaunched automatically. */
export async function recoverPlan(io: Io): Promise<void> {
  const board = await readPlan(io)
  const active = Object.values(board.changes).flatMap(rec => (rec.activeAgent === undefined ? [] : [{ changeId: rec.id, agentId: rec.activeAgent.agentId }]))
  if (active.length === 0) return
  const alive = new Set((await io.agent.list()).map(info => info.id))
  await appendPlan(io, active.filter(entry => !alive.has(entry.agentId)).map(entry => ({ type: 'PlanAgentStopped' as const, ...entry, outcome: 'interrupted' as const })))
}

/** Our own mirror body; only shapes zboard wrote are taken. */
export function parseMirror(text: string | undefined): Restored | undefined {
  let value: unknown
  try {
    value = text === undefined ? undefined : JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isRecord(value)) return undefined
  return {
    revisions: Array.isArray(value.revisions) ? (value.revisions.filter(isRecord) as unknown as Revision[]) : [],
    ...(isRecord(value.qa) && Array.isArray(value.qa.turns) ? { qa: value.qa as unknown as QaSession } : {}),
    ...(Array.isArray(value.critique) ? { critique: value.critique as unknown as CritiqueFinding[] } : {}),
    ...(isRecord(value.verify) && Array.isArray(value.verify.findings) ? { verify: value.verify as unknown as VerifyRun } : {}),
  }
}

/** Fills Q&A, revisions, critique and findings of listed changes that have none locally (a new session). */
export async function restoreMirrors(io: Io, ids: readonly string[]): Promise<void> {
  const board = await readPlan(io)
  const project = projectOf(await io.session.root())
  const events: PlanEventBody[] = []
  for (const id of ids) {
    const rec = board.changes[id]
    const isEmpty = rec !== undefined && !rec.archived && rec.qa === undefined && rec.revisions.length === 0 && rec.critique === undefined && rec.verify === undefined
    if (!isEmpty) continue
    const restored = parseMirror((await fetchTopic(io, planTopic(project, id)))?.text)
    if (restored !== undefined) events.push({ type: 'PlanRestored', changeId: id, ...restored })
  }
  await appendPlan(io, events)
}
