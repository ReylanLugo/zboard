import type { Io } from './io.ts'

import { readOptional } from '../adapters/artifacts.ts'
import { readProjectConfig } from '../adapters/config-io.ts'
import { parseTasksMd } from '../adapters/tasks-md.ts'
import { globalLayer, resolvePlanChoice } from '../domain/config.ts'
import { forecastOf } from '../plan/forecast.ts'
import type { DiffProposal, Forecast } from '../plan/types.ts'
import { PLAN_ARTIFACT, changeDir } from '../plan/types.ts'
import type { Ctx } from './ctx.ts'
import { TOKENS_KEY, startJob } from './plan-runner.ts'
import { appendPlan, readPlan } from './plan-store.ts'

const setForecast = async (io: Io, forecast: Forecast | null): Promise<void> => {
  await io.state.ui.update(ui => ({ ...ui, changes: { ...ui.changes, forecast } }))
  io.ui.invalidate()
}

export async function showForecast(io: Io, ctx: Ctx, changeId: string): Promise<boolean> {
  const tasks = await readOptional(io, `${changeDir(changeId)}/tasks.md`)
  const groups = tasks === null ? [] : [...new Set(parseTasksMd(tasks).tasks.map(task => task.section))]
  if (groups.length === 0) {
    io.ui.toast('zboard: tasks.md has no task group to plan')
    return false
  }
  const project = await readProjectConfig(io)
  const choice = resolvePlanChoice('drafter', { project: project.layers.drafter, global: globalLayer(ctx.options, 'drafter') }, PLAN_ARTIFACT)
  const stored = await io.store.get(TOKENS_KEY)
  const history = Array.isArray(stored) ? stored.filter((value): value is number => typeof value === 'number') : []
  await setForecast(io, forecastOf(changeId, groups, choice, history))
  return true
}

export const dismissForecast = (io: Io): Promise<void> => setForecast(io, null)

export async function confirmForecast(io: Io, ctx: Ctx): Promise<boolean> {
  const forecast = (await io.state.ui.read()).changes.forecast
  const first = forecast?.groups[0]
  if (forecast === null || first === undefined) return false
  await setForecast(io, null)
  await appendPlan(io, [{ type: 'DraftRequested', changeId: forecast.changeId, artifact: PLAN_ARTIFACT, groups: forecast.groups }])
  return startJob(io, ctx, forecast.changeId, { kind: 'draft', artifact: PLAN_ARTIFACT, group: first })
}

/** After a group's proposal is accepted, the drafter runs for the next group only. */
export async function continuePlanGroups(io: Io, ctx: Ctx, changeId: string, proposal: DiffProposal): Promise<void> {
  if (proposal.source.group === undefined) return
  const groups = (await readPlan(io)).changes[changeId]?.planGroups
  const next = groups?.groups[groups.next]
  if (groups === undefined || next === undefined) return
  await startJob(io, ctx, changeId, { kind: 'draft', artifact: PLAN_ARTIFACT, group: next })
}
