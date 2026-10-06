import type { Io } from './io.ts'

import { actionsFor, nextArtifact } from '../plan/lifecycle.ts'
import type { Ctx } from './ctx.ts'
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
  return startJob(io, ctx, changeId, { kind: 'draft', artifact: next.id })
}
