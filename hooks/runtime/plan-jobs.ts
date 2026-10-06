import { onProposalAccepted } from './plan-apply.ts'
import { brainstormJob } from './plan-brainstorm.ts'
import { critiqueJob } from './plan-critique.ts'
import { draftJob } from './plan-draft.ts'
import { explainJob } from './plan-explain.ts'
import { continuePlanGroups } from './plan-forecast.ts'
import { defineJob } from './plan-runner.ts'
import { judgeJob } from './plan-verify.ts'

let isWired = false

/** Defines every plan job handler; register.tsx calls it once (like installOrchestrator). */
export function installPlanJobs(): void {
  defineJob('draft', draftJob)
  defineJob('brainstorm', brainstormJob)
  defineJob('explain', explainJob)
  defineJob('critique', critiqueJob)
  defineJob('judge', judgeJob)
  if (isWired) return
  isWired = true
  onProposalAccepted(continuePlanGroups)
}
