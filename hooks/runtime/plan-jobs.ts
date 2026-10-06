import { brainstormJob } from './plan-brainstorm.ts'
import { draftJob } from './plan-draft.ts'
import { defineJob } from './plan-runner.ts'

/** Defines every plan job handler; register.tsx calls it once (like installOrchestrator). */
export function installPlanJobs(): void {
  defineJob('draft', draftJob)
  defineJob('brainstorm', brainstormJob)
}
