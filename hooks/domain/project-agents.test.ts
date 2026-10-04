import { expect, test } from 'claude-code/testing'

import type { EventBody } from './events.ts'
import { evs, loaded, parsed } from '../testing/factories.ts'
import { activeRun, project, taskOfAgent } from './project.ts'

const started = (phase: 'research' | 'review' | 'refactor' | 'code', agentId: string, attempt = 1): EventBody => ({
  type: 'PhaseStarted', taskId: '1.1', phase, attempt, agentId,
  agentType: `zboard:${phase === 'code' ? 'implementer' : phase === 'review' ? 'reviewer' : phase === 'refactor' ? 'refactorer' : 'researcher'}`,
  role: phase === 'code' ? 'implementer' : phase === 'review' ? 'reviewer' : phase === 'refactor' ? 'refactorer' : 'researcher',
  model: 'claude-sonnet-5-5', effort: 'medium', baseline: { 'src/a.ts': 'abc' },
})

test('PhaseStarted opens a run and sets running, or review for the review phase', () => {
  const research = project(evs([loaded(parsed('1.1')), started('research', 'a1')]))
  const task = research.tasks['1.1']
  expect(task?.status).toBe('running')
  expect(task?.phase).toBe('research')
  expect(task?.agents[0]).toMatchObject({ agentId: 'a1', phase: 'research', attempt: 1, tokens: 0, denies: 0, startedAt: 1_001 })
  const review = project(evs([loaded(parsed('1.1')), started('review', 'a2')]))
  expect(review.tasks['1.1']?.status).toBe('review')
})

test('refactor attempt 1 increments loop; its retry does not', () => {
  const board = project(evs([loaded(parsed('1.1')), started('refactor', 'a1'), started('refactor', 'a2', 2)]))
  expect(board.tasks['1.1']?.loop).toBe(1)
})

test('AgentActivity updates the run and adds tokens; an unknown agent changes nothing', () => {
  const board = project(evs([
    loaded(parsed('1.1')),
    started('code', 'a1'),
    { type: 'AgentActivity', agentId: 'a1', tool: 'Edit' },
    { type: 'AgentActivity', agentId: 'a1', tokens: 1200 },
    { type: 'AgentActivity', agentId: 'ghost', tool: 'Write', tokens: 5 },
  ]))
  const run = board.tasks['1.1']?.agents[0]
  expect(run?.currentTool).toBe('Edit')
  expect(run?.tokens).toBe(1200)
  expect(run?.lastActivityAt).toBe(1_003)
  expect(taskOfAgent(board, 'ghost')).toBeUndefined()
})

test('AgentStopped records endedAt, transcript and effort without deciding the outcome', () => {
  const board = project(evs([
    loaded(parsed('1.1')),
    started('code', 'a1'),
    { type: 'AgentStopped', agentId: 'a1', transcriptPath: '/t/a1.jsonl', effort: 'high' },
  ]))
  const task = board.tasks['1.1']
  expect(task?.agents[0]).toMatchObject({ endedAt: 1_002, transcriptPath: '/t/a1.jsonl', effort: 'high' })
  expect(task?.agents[0]?.outcome).toBeUndefined()
  expect(task && activeRun(task)).toBeUndefined()
})

test('an interrupted stop overrides any recorded outcome', () => {
  const board = project(evs([
    loaded(parsed('1.1')),
    started('code', 'a1'),
    { type: 'AgentStopped', agentId: 'a1', outcome: 'interrupted' },
  ]))
  expect(board.tasks['1.1']?.agents[0]?.outcome).toBe('interrupted')
})

test('PhaseCompleted records the gate, copies plan files and touched paths, and marks the run', () => {
  const board = project(evs([
    loaded(parsed('1.1')),
    started('research', 'a1'),
    {
      type: 'PhaseCompleted', taskId: '1.1', phase: 'research', attempt: 1, gate: 'pass', summary: '2 findings',
      artifactKey: '1.1/research-1-l0', allowedFiles: ['src/a.ts'], testFiles: ['tests/a.test.ts'], touched: ['src/a.ts'],
    },
  ]))
  const task = board.tasks['1.1']
  expect(task?.phases).toEqual([{ phase: 'research', attempt: 1, loop: 0, gate: 'pass', summary: '2 findings', artifactKey: '1.1/research-1-l0', reason: undefined, at: 1_002 }])
  expect(task?.allowedFiles).toEqual(['src/a.ts'])
  expect(task?.testFiles).toEqual(['tests/a.test.ts'])
  expect(task?.touched).toEqual(['src/a.ts'])
  expect(task?.agents[0]?.outcome).toBe('ok')
})

test('a failed gate marks the run gate_failed and keeps earlier plan files', () => {
  const board = project(evs([
    loaded(parsed('1.1')),
    started('code', 'a1'),
    { type: 'PhaseCompleted', taskId: '1.1', phase: 'code', attempt: 1, gate: 'fail', reason: 'tests fail' },
  ]))
  expect(board.tasks['1.1']?.agents[0]?.outcome).toBe('gate_failed')
  expect(board.tasks['1.1']?.phases[0]?.reason).toBe('tests fail')
})

test('ReviewVerdictRecorded stores the verdict and GuardDenied counts denies', () => {
  const verdict = { verdict: 'changes' as const, findings: [{ severity: 'high' as const, file: 'src/a.ts', issue: 'leak' }] }
  const board = project(evs([
    loaded(parsed('1.1')),
    started('code', 'a1'),
    { type: 'GuardDenied', taskId: '1.1', agentId: 'a1', path: 'src/x.ts' },
    { type: 'GuardDenied', taskId: '1.1', agentId: 'a1', path: 'src/y.ts' },
    { type: 'ReviewVerdictRecorded', taskId: '1.1', verdict },
  ]))
  expect(board.tasks['1.1']?.agents[0]?.denies).toBe(2)
  expect(board.tasks['1.1']?.verdict).toEqual(verdict)
})
