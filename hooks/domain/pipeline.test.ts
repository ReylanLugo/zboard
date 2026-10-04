import { expect, test } from 'claude-code/testing'

import type { GateOutcome } from './gates.ts'
import { next } from './pipeline.ts'
import type { Phase, Task } from './types.ts'
import { newTask } from './types.ts'

const task = (loop = 0): Task => ({ ...newTask({ id: '2.1', changeId: 'demo', title: 'Parse tasks', source: 'openspec' }), loop })
const pass = (extra: Partial<Extract<GateOutcome, { gate: 'pass' }>> = {}): GateOutcome => ({ gate: 'pass', summary: 'ok', ...extra })
const failed = (reason = 'bad', terminal = false): GateOutcome => ({ gate: 'fail', reason, terminal })
const done = (phase: Phase, outcome: GateOutcome, attempt = 1) => ({ kind: 'completed' as const, phase, attempt, outcome })

test('start advances to research', () => {
  expect(next(task(), { kind: 'start' })).toEqual({ kind: 'advance', phase: 'research' })
})

test('happy path walks research → plan → tdd → code → review → done', () => {
  expect(next(task(), done('research', pass()))).toEqual({ kind: 'advance', phase: 'plan' })
  expect(next(task(), done('plan', pass()))).toEqual({ kind: 'advance', phase: 'tdd' })
  expect(next(task(), done('tdd', pass()))).toEqual({ kind: 'advance', phase: 'code' })
  expect(next(task(), done('code', pass()))).toEqual({ kind: 'advance', phase: 'review' })
  expect(next(task(), done('review', pass({ verdict: { verdict: 'approve', findings: [] } })))).toEqual({ kind: 'done' })
})

test('changes verdict loops to refactor, and refactor returns to review', () => {
  const changes = pass({ verdict: { verdict: 'changes', findings: [{ severity: 'high', file: 'a.ts', issue: 'x' }] } })
  expect(next(task(0), done('review', changes))).toEqual({ kind: 'loop' })
  expect(next(task(1), done('refactor', pass()))).toEqual({ kind: 'advance', phase: 'review' })
})

test('changes verdict at the loop cap escalates instead of refactoring', () => {
  const changes = pass({ verdict: { verdict: 'changes', findings: [{ severity: 'low', file: 'a.ts', issue: 'x' }] } })
  expect(next(task(3), done('review', changes))).toEqual({ kind: 'escalate', reason: 'review loop cap reached (3) with changes requested' })
})

test('first gate failure relaunches the same phase once with the reason', () => {
  expect(next(task(), done('code', failed('code: tests fail: t1')))).toEqual({ kind: 'spawn', phase: 'code', attempt: 2, reason: 'code: tests fail: t1' })
})

test('second gate failure escalates', () => {
  expect(next(task(), done('code', failed('code: tests fail: t1'), 2))).toEqual({ kind: 'escalate', reason: 'code gate failed twice: code: tests fail: t1' })
})

test('a terminal failure escalates at once with its reason', () => {
  expect(next(task(), done('code', failed('ptest incomplete twice: ptest: incomplete (exit 70)', true)))).toEqual({
    kind: 'escalate', reason: 'code gate failed: ptest incomplete twice: ptest: incomplete (exit 70)',
  })
})

test('a review that passes without a verdict escalates', () => {
  expect(next(task(), done('review', pass()))).toEqual({ kind: 'escalate', reason: 'review passed without a verdict' })
})
