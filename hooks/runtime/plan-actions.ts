import type { Io } from './io.ts'

import { actionsFor, nextArtifact } from '../plan/lifecycle.ts'
import { BRAINSTORM_ARTIFACT, PLAN_ARTIFACT } from '../plan/types.ts'
import type { Ctx } from './ctx.ts'
import { draftFromTurns, startBrainstorm } from './plan-brainstorm.ts'
import { showForecast } from './plan-forecast.ts'
import { startJob } from './plan-runner.ts'
import { readPlan } from './plan-store.ts'

/** D10 "Draft next": pending plan groups first, then the first ready planning artifact in CLI order. */
export async function draftNext(io: Io, ctx: Ctx, changeId: string): Promise<boolean> {
  const rec = (await readPlan(io)).changes[changeId]
  const gate = actionsFor(rec).draft
  if (rec === undefined || !gate.enabled) {
    io.ui.toast(`zboard: ${gate.reason}`)
    return false
  }
  const groups = rec.planGroups
  const group = groups?.groups[groups.next]
  if (group !== undefined) return startJob(io, ctx, changeId, { kind: 'draft', artifact: PLAN_ARTIFACT, group })
  const next = nextArtifact(rec)
  if (next === undefined) {
    io.ui.toast(`zboard: ${gate.reason}`)
    return false
  }
  if (next.id === BRAINSTORM_ARTIFACT) return rec.qa?.done === true ? draftFromTurns(io, ctx, changeId) : startBrainstorm(io, ctx, changeId)
  if (next.id === PLAN_ARTIFACT) return showForecast(io, ctx, changeId)
  return startJob(io, ctx, changeId, { kind: 'draft', artifact: next.id })
}
