import type { Io } from './io.ts'

import { changeFiles, changeFingerprint } from '../adapters/artifacts.ts'
import { explainPrompt } from '../adapters/prompts-plan.ts'
import { isRecord } from '../domain/json.ts'
import { parseExplanation } from '../plan/contracts.ts'
import { actionsFor } from '../plan/lifecycle.ts'
import type { ChangeRecord, Explanation, PlanJob } from '../plan/types.ts'
import type { Ctx } from './ctx.ts'
import { renderDiagrams } from './mermaid.ts'
import type { JobHandler } from './plan-runner.ts'
import { startJob } from './plan-runner.ts'
import { appendPlan, readPlan } from './plan-store.ts'

type ExplainJob = Extract<PlanJob, { readonly kind: 'explain' }>

export const explainKey = (changeId: string): string => `zplan/explain/${changeId}`

interface Cached {
  readonly fingerprint: string
  readonly explanation: Explanation
}

const isCached = (value: unknown): value is Cached =>
  isRecord(value) && typeof value.fingerprint === 'string' && isRecord(value.explanation) && typeof value.explanation.overview === 'string'

export const isExplanationCurrent = (rec: ChangeRecord): boolean =>
  rec.explanation !== undefined && rec.explanation.fingerprint === rec.fingerprint

async function done(io: Io, _ctx: Ctx, changeId: string, _job: ExplainJob, value: Explanation): Promise<void> {
  const fingerprint = await changeFingerprint(io, changeId)
  const explanation: Explanation = { ...value, diagrams: await renderDiagrams(io, value.diagrams) }
  await io.store.set(explainKey(changeId), { fingerprint, explanation })
  await appendPlan(io, [{ type: 'ExplanationCached', changeId, fingerprint, explanation }])
}

export const explainJob: JobHandler<ExplainJob, Explanation> = {
  prompt: async (io, changeId, _job, gateReason) => explainPrompt({ changeId, artifacts: await changeFiles(io, changeId), gateReason }),
  parse: parseExplanation,
  done,
}

/** D12: reuse while the fingerprint matches (this session or the store), otherwise spawn the explainer. */
export async function explainChange(io: Io, ctx: Ctx, changeId: string): Promise<boolean> {
  const rec = (await readPlan(io)).changes[changeId]
  const gate = actionsFor(rec).explain
  if (rec === undefined || !gate.enabled) {
    io.ui.toast(`zboard: ${gate.reason}`)
    return false
  }
  const fingerprint = await changeFingerprint(io, changeId)
  if (rec.explanation?.fingerprint === fingerprint) {
    io.ui.toast('zboard: the explanation is current')
    return true
  }
  const cached = await io.store.get(explainKey(changeId))
  if (isCached(cached) && cached.fingerprint === fingerprint) {
    await appendPlan(io, [{ type: 'ExplanationCached', changeId, fingerprint, explanation: cached.explanation }])
    return true
  }
  return startJob(io, ctx, changeId, { kind: 'explain' })
}
