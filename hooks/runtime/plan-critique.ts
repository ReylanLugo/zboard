import type { Io } from './io.ts'

import { changeFiles } from '../adapters/artifacts.ts'
import { critiquePrompt } from '../adapters/prompts-plan.ts'
import { parseCritique } from '../plan/contracts.ts'
import { actionsFor } from '../plan/lifecycle.ts'
import type { CritiqueFinding, PlanJob } from '../plan/types.ts'
import type { Ctx } from './ctx.ts'
import { commentOn } from './plan-draft.ts'
import type { JobHandler } from './plan-runner.ts'
import { startJob } from './plan-runner.ts'
import { appendPlan, readPlan } from './plan-store.ts'

type CritiqueJob = Extract<PlanJob, { readonly kind: 'critique' }>

export const critiqueJob: JobHandler<CritiqueJob, { readonly findings: readonly CritiqueFinding[] }> = {
  prompt: async (io, changeId, _job, gateReason) => critiquePrompt({ changeId, artifacts: await changeFiles(io, changeId), gateReason }),
  parse: parseCritique,
  done: async (io, _ctx, changeId, _job, value) => {
    await appendPlan(io, [{ type: 'CritiqueRecorded', changeId, findings: value.findings }])
  },
}

export async function critiqueChange(io: Io, ctx: Ctx, changeId: string): Promise<boolean> {
  const gate = actionsFor((await readPlan(io)).changes[changeId]).critique
  if (!gate.enabled) {
    io.ui.toast(`zboard: ${gate.reason}`)
    return false
  }
  return startJob(io, ctx, changeId, { kind: 'critique' })
}

/** D11: a finding becomes a comment that starts an iteration proposal on its artifact. */
export async function findingToComment(io: Io, ctx: Ctx, changeId: string, index: number): Promise<boolean> {
  const finding = (await readPlan(io)).changes[changeId]?.critique?.[index]
  if (finding === undefined) {
    io.ui.toast('zboard: that critique finding no longer exists')
    return false
  }
  return commentOn(io, ctx, changeId, finding.artifact, `Critique (${finding.severity}): ${finding.issue}\nSuggestion: ${finding.suggestion}`)
}
