import { onProposalAccepted } from './plan-apply.ts'
import { brainstormJob } from './plan-brainstorm.ts'
import { draftJob } from './plan-draft.ts'
import { continuePlanGroups } from './plan-forecast.ts'
import { defineJob } from './plan-runner.ts'

let isWired = false

/** Defines every plan job handler; register.tsx calls it once (like installOrchestrator). */
export function installPlanJobs(): void {
  defineJob('draft', draftJob)
  defineJob('brainstorm', brainstormJob)
  if (isWired) return
  isWired = true
  onProposalAccepted(continuePlanGroups)
}
