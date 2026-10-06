import type { PlanEvent, PlanEventBody } from './plan-events.ts'
import { projectPlan } from './plan-project.ts'
import type { PlanBoard } from './types.ts'

export interface PlanLog {
  readonly snapshot: PlanBoard | null
  readonly tail: readonly PlanEvent[]
  readonly seq: number
}

export const EMPTY_PLAN_LOG: PlanLog = { snapshot: null, tail: [], seq: 0 }
export const PLAN_SNAPSHOT_THRESHOLD = 300

/** Appends events; once the tail reaches the threshold it folds into the snapshot (same rule as the board log). */
export function appendPlanEvents(
  log: PlanLog,
  bodies: readonly PlanEventBody[],
  at: number,
  threshold: number = PLAN_SNAPSHOT_THRESHOLD,
): { log: PlanLog; events: PlanEvent[] } {
  const events = bodies.map((body, index): PlanEvent => ({ ...body, seq: log.seq + index + 1, at }))
  const tail = [...log.tail, ...events]
  const seq = log.seq + events.length
  if (tail.length < threshold) return { log: { ...log, tail, seq }, events }
  return { log: { snapshot: projectPlan(tail, log.snapshot ?? undefined), tail: [], seq }, events }
}

export const planOf = (log: PlanLog): PlanBoard => projectPlan(log.tail, log.snapshot ?? undefined)
