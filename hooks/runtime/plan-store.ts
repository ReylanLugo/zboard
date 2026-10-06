import type { PlanEventBody } from '../plan/plan-events.ts'
import { appendPlanEvents, planOf } from '../plan/plan-log.ts'
import type { PlanBoard } from '../plan/types.ts'
import type { Io } from './io.ts'
import { message } from './log-store.ts'

export type PlanAppendListener = (io: Io, before: PlanBoard, after: PlanBoard, events: readonly PlanEventBody[]) => Promise<void>

const listeners: PlanAppendListener[] = []

export const onPlanAppend = (listener: PlanAppendListener): void => {
  listeners.push(listener)
}

export const readPlan = async (io: Io): Promise<PlanBoard> => planOf(await io.state.plan.read())

export async function appendPlan(io: Io, bodies: readonly PlanEventBody[]): Promise<PlanBoard> {
  if (bodies.length === 0) return readPlan(io)
  const at = await io.clock.now()
  let before: PlanBoard | undefined
  const log = await io.state.plan.update(current => {
    before = planOf(current)
    return appendPlanEvents(current, bodies, at).log
  })
  const after = planOf(log)
  io.ui.invalidate()
  for (const listener of listeners) {
    await listener(io, before ?? after, after, bodies).catch(error => {
      io.ui.debug(`zboard: a plan listener failed: ${message(error)}`)
    })
  }
  return after
}

export async function recordPlanError(io: Io, hook: string, error: unknown, changeId?: string): Promise<void> {
  try {
    await appendPlan(io, [{ type: 'PlanError', hook, message: message(error), ...(changeId === undefined ? {} : { changeId }) }])
  } catch (inner) {
    io.ui.debug(`zboard: ${hook} failed (${message(error)}) and could not be recorded: ${message(inner)}`)
  }
}

/** D16: a plan hook's failure becomes a PlanError on its change (or the header) instead of escaping. */
export async function isolatePlan<T>(io: Io, hook: string, work: () => Promise<T>, fallback: T, changeId?: string): Promise<T> {
  try {
    return await work()
  } catch (error) {
    await recordPlanError(io, hook, error, changeId)
    return fallback
  }
}
