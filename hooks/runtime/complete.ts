import { captureStop } from './capture.ts'
import type { Ctx } from './ctx.ts'
import { roleOfAgent, stopAnswer } from './handback.ts'
import type { Io } from './io.ts'
import { isolate } from './log-store.ts'
import { planStop } from './plan-runner.ts'
import { isolatePlan } from './plan-store.ts'

// A zboard agent's completion. The engine raises a zboard-spawned agent's
// SubagentStop beneath zboard's own spawn and skips zboard's hook for it
// (re-entry); the run's `turn.complete`, carrying its agentId, does reach zboard.
// Either event completes the agent: whichever comes first wins, the other is a no-op.

export interface AgentEnd {
  readonly agentId: string
  /** The run's final text (`turn.complete`'s answer, SubagentStop's last message); blank for a hand-back. */
  readonly text?: string
  readonly transcriptPath?: string
  readonly effort?: string
}

/** True for the first claim of an agent's completion, false for every later one. */
export type Claim = (agentId: string) => boolean

/** Most recent claims kept; an older agent's run has long ended, which also refuses a repeat. */
export const CLAIM_CAP = 256

export const withClaim = (claims: readonly string[], agentId: string): readonly string[] =>
  [...claims, agentId].slice(-CLAIM_CAP)

/** A claim ledger: synchronous check-and-set, so two completions in one tick cannot both win. */
export function claimLedger(): Claim {
  let claims: readonly string[] = []
  return agentId => {
    if (claims.includes(agentId)) return false
    claims = withClaim(claims, agentId)
    return true
  }
}

/**
 * Completes a running zboard agent once: its answer (final text, else the report
 * in its messages), the board's stop now, the plan's next step after this dispatch.
 */
export async function completeAgent(io: Io, ctx: Ctx, end: AgentEnd, claim: Claim): Promise<void> {
  if ((await roleOfAgent(io, end.agentId)) === undefined) return
  if (!claim(end.agentId)) return
  const answer = await isolate(io, 'handback.stop', () => stopAnswer(io, end.agentId, end.text), end.text)
  const stop = { agentId: end.agentId, transcriptPath: end.transcriptPath, answer, effort: end.effort }
  await isolate(io, 'capture.stop', () => captureStop(io, stop), undefined)
  // A plan agent's next step (a retry or the next job) spawns after this dispatch, never inside it.
  io.clock.after(0, () => {
    void isolatePlan(io, 'plan.stop', () => planStop(io, ctx, stop), undefined)
  })
}
