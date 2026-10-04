import { expect, test } from 'claude-code/testing'

import type { EventBody } from './events.ts'
import { evs, loaded, parsed } from '../testing/factories.ts'
import { project } from './project.ts'
import { runnable, waitReason, writeConflict } from './scheduler.ts'

const running: EventBody = { type: 'RunControl', running: true, paused: false }
const status = (taskId: string, to: 'running' | 'done' | 'blocked'): EventBody => ({ type: 'TaskStatusChanged', taskId, from: 'ready', to })

test('nothing is runnable until the pipeline runs, and nothing while paused', () => {
  expect(runnable(project(evs([loaded(parsed('1.1'))])), { limit: 3 })).toEqual([])
  expect(runnable(project(evs([loaded(parsed('1.1')), { type: 'RunControl', running: true, paused: true }])), { limit: 3 })).toEqual([])
})

test('a fourth runnable task waits while three run', () => {
  const board = project(evs([
    loaded(parsed('1.1'), parsed('1.2'), parsed('1.3'), parsed('1.4')),
    running, status('1.1', 'running'), status('1.2', 'running'), status('1.3', 'running'),
  ]))
  expect(runnable(board, { limit: 3 })).toEqual([])
})

test('a task with an unmet dependency is not started', () => {
  const board = project(evs([loaded(parsed('1.2'), parsed('1.3', { dependsOn: ['1.2'] })), running]))
  expect(runnable(board, { limit: 3 })).toEqual(['1.2'])
})

test('a dependency on 1.1 ignores 1.10', () => {
  const board = project(evs([
    loaded(parsed('1.1'), parsed('1.10'), parsed('2.1', { dependsOn: ['1.1'] })),
    running, status('1.10', 'done'), status('1.1', 'blocked'),
  ]))
  expect(runnable(board, { limit: 3 })).not.toContain('2.1')
})

test('blocked, pending and non-openspec tasks are not started; priority orders the rest', () => {
  const board = project(evs([
    loaded(parsed('1.1'), parsed('1.2'), parsed('1.3'), parsed('1.4')),
    { type: 'TaskCreated', task: { id: 'b1', title: 'Board', source: 'board' } },
    running,
    status('1.1', 'blocked'),
    { type: 'TaskUpdated', taskId: '1.2', patch: { pending: { phase: 'research', attempt: 1 } } },
    { type: 'TaskUpdated', taskId: '1.4', patch: { priority: 2 } },
  ]))
  expect(runnable(board, { limit: 3 })).toEqual(['1.4', '1.3'])
})

test('a scope limits the run to one label', () => {
  const board = project(evs([loaded(parsed('1.1'), parsed('1.2')), running]))
  expect(runnable(board, { limit: 3, scope: '1.2' })).toEqual(['1.2'])
})

test('overlapping allowed files make the second task wait before code', () => {
  const board = project(evs([
    loaded(parsed('1.2'), parsed('1.4')),
    running,
    { type: 'PhaseCompleted', taskId: '1.2', phase: 'plan', attempt: 1, gate: 'pass', allowedFiles: ['auth.ts'], testFiles: ['auth.test.ts'] },
    { type: 'PhaseCompleted', taskId: '1.4', phase: 'plan', attempt: 1, gate: 'pass', allowedFiles: ['auth.ts', 'b.ts'], testFiles: ['b.test.ts'] },
    { type: 'PhaseStarted', taskId: '1.2', phase: 'code', attempt: 1, agentId: 'a1', agentType: 'zboard:implementer', role: 'implementer', model: 'm', baseline: {} },
  ]))
  const conflict = writeConflict(board, '1.4')
  expect(conflict).toEqual({ holder: '1.2', file: 'auth.ts' })
  expect(conflict && waitReason(conflict)).toBe('waits 1.2 for auth.ts')
  expect(writeConflict(board, '1.2')).toBeUndefined()
})
