import type { GateOutcome } from './gates.ts'
import type { Phase, Task } from './types.ts'
import { LOOP_CAP } from './types.ts'

export type PipelineInput =
  | { readonly kind: 'start' }
  | { readonly kind: 'completed'; readonly phase: Phase; readonly attempt: number; readonly outcome: GateOutcome }

export type Action =
  | { readonly kind: 'advance'; readonly phase: Phase }
  | { readonly kind: 'spawn'; readonly phase: Phase; readonly attempt: number; readonly reason: string }
  | { readonly kind: 'loop' }
  | { readonly kind: 'escalate'; readonly reason: string }
  | { readonly kind: 'done' }

const FOLLOWS: Readonly<Partial<Record<Phase, Phase>>> = {
  research: 'plan',
  plan: 'tdd',
  tdd: 'code',
  code: 'review',
  refactor: 'review',
}

export function next(task: Task, input: PipelineInput, cap: number = LOOP_CAP): Action {
  if (input.kind === 'start') return { kind: 'advance', phase: 'research' }
  const { phase, attempt, outcome } = input
  if (outcome.gate === 'fail') {
    if (outcome.terminal) return { kind: 'escalate', reason: `${phase} gate failed: ${outcome.reason}` }
    if (attempt >= 2) return { kind: 'escalate', reason: `${phase} gate failed twice: ${outcome.reason}` }
    return { kind: 'spawn', phase, attempt: attempt + 1, reason: outcome.reason }
  }
  const following = FOLLOWS[phase]
  if (following !== undefined) return { kind: 'advance', phase: following }
  if (outcome.verdict === undefined) return { kind: 'escalate', reason: 'review passed without a verdict' }
  if (outcome.verdict.verdict === 'approve') return { kind: 'done' }
  return task.loop >= cap
    ? { kind: 'escalate', reason: `review loop cap reached (${cap}) with changes requested` }
    : { kind: 'loop' }
}
