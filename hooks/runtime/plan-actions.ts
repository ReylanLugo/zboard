import type { Io } from './io.ts'

import { actionsFor, nextArtifact } from '../plan/lifecycle.ts'
import { BRAINSTORM_ARTIFACT } from '../plan/types.ts'
import type { Ctx } from './ctx.ts'
import { draftFromTurns, startBrainstorm } from './plan-brainstorm.ts'
import { startJob } from './plan-runner.ts'
import { readPlan } from './plan-store.ts'

/** D10 "Draft next": the first ready planning artifact in `openspec status --json` order. */
export async function draftNext(io: Io, ctx: Ctx, changeId: string): Promise<boolean> {
  const rec = (await readPlan(io)).changes[changeId]
  const gate = actionsFor(rec).draft
  const next = rec === undefined ? undefined : nextArtifact(rec)
  if (rec === undefined || !gate.enabled || next === undefined) {
    io.ui.toast(`zboard: ${gate.reason}`)
    return false
  }
  if (next.id === BRAINSTORM_ARTIFACT) return rec.qa?.done === true ? draftFromTurns(io, ctx, changeId) : startBrainstorm(io, ctx, changeId)
  return startJob(io, ctx, changeId, { kind: 'draft', artifact: next.id })
}
