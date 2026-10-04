import { expect, test } from 'claude-code/testing'

import { deepFreeze, ev, evs, loaded, parsed } from '../testing/factories.ts'
import { project } from './project.ts'
import { newTask } from './types.ts'

test('ChangeLoaded creates openspec tasks as ready, or done when checked', () => {
  const board = project(evs([loaded(parsed('1.1'), parsed('1.2', { done: true }))]))
  expect(board.changeId).toBe('demo')
  expect(board.order).toEqual(['1.1', '1.2'])
  expect(board.tasks['1.1']?.status).toBe('ready')
  expect(board.tasks['1.1']?.source).toBe('openspec')
  expect(board.tasks['1.2']?.status).toBe('done')
})

test('a task inserted above 2.1 leaves 2.1 with its execution state', () => {
  const board = project(evs([
    loaded(parsed('1.1'), parsed('2.1')),
    { type: 'TaskUpdated', taskId: '2.1', patch: { priority: 5, pending: { phase: 'plan', attempt: 1 } } },
    loaded(parsed('1.1'), parsed('1.2'), parsed('2.1')),
  ]))
  expect(board.order).toEqual(['1.1', '1.2', '2.1'])
  expect(board.tasks['2.1']?.priority).toBe(5)
  expect(board.tasks['2.1']?.pending).toEqual({ phase: 'plan', attempt: 1 })
})

test('tasks.md done-state wins over a running task', () => {
  const board = project(evs([
    loaded(parsed('1.1')),
    { type: 'TaskStatusChanged', taskId: '1.1', from: 'ready', to: 'running' },
    loaded(parsed('1.1', { done: true })),
  ]))
  expect(board.tasks['1.1']?.status).toBe('done')
})

test('an openspec task removed from tasks.md disappears; board and native tasks stay', () => {
  const board = project(evs([
    loaded(parsed('1.1'), parsed('1.2')),
    { type: 'TaskCreated', task: { id: 'b1', title: 'Board task', source: 'board' } },
    loaded(parsed('1.1')),
  ]))
  expect(board.order).toEqual(['1.1', 'b1'])
  expect(board.tasks['1.2']).toBeUndefined()
})

test('TaskCreated adds a task once; a duplicate id is ignored', () => {
  const board = project(evs([
    loaded(parsed('1.1')),
    { type: 'TaskCreated', task: { id: 'n7', title: 'Native', source: 'native' } },
    { type: 'TaskCreated', task: { id: 'n7', title: 'Other', source: 'native' } },
  ]))
  expect(board.tasks.n7?.title).toBe('Native')
  expect(board.order).toEqual(['1.1', 'n7'])
})

test('TaskStatusChanged sets status and reason and clears pending', () => {
  const board = project(evs([
    loaded(parsed('1.1')),
    { type: 'TaskUpdated', taskId: '1.1', patch: { pending: { phase: 'code', attempt: 2, reason: 'x' } } },
    { type: 'TaskStatusChanged', taskId: '1.1', from: 'running', to: 'needs_decision', reason: 'code gate failed twice' },
  ]))
  expect(board.tasks['1.1']?.status).toBe('needs_decision')
  expect(board.tasks['1.1']?.statusReason).toBe('code gate failed twice')
  expect(board.tasks['1.1']?.pending).toBeUndefined()
})

test('TaskUpdated merges overrides per role and an empty waitReason clears it', () => {
  const board = project(evs([
    loaded(parsed('1.1')),
    { type: 'TaskUpdated', taskId: '1.1', patch: { waitReason: 'waits 1.2 for a.ts', overrides: { reviewer: { model: 'opus 5.5' } } } },
    { type: 'TaskUpdated', taskId: '1.1', patch: { waitReason: '', overrides: { implementer: { effort: 'high' } } } },
  ]))
  expect(board.tasks['1.1']?.waitReason).toBeUndefined()
  expect(board.tasks['1.1']?.overrides).toEqual({ reviewer: { model: 'opus 5.5' }, implementer: { effort: 'high' } })
})

test('CommentAdded then CommentDelivered records the recipient', () => {
  const board = project(evs([
    loaded(parsed('1.1')),
    { type: 'CommentAdded', taskId: '1.1', comment: { id: 'c1', author: 'user', text: 'use the cache' } },
    { type: 'CommentDelivered', taskId: '1.1', commentId: 'c1', to: 'zboard:implementer' },
  ]))
  expect(board.tasks['1.1']?.comments).toEqual([
    { id: 'c1', author: 'user', text: 'use the cache', at: 1_001, deliveredTo: 'zboard:implementer' },
  ])
})

test('TaskRemoved drops a native task', () => {
  const board = project(evs([
    { type: 'TaskCreated', task: { id: 'n1', title: 'Native', source: 'native' } },
    { type: 'TaskRemoved', taskId: 'n1' },
  ]))
  expect(board.tasks.n1).toBeUndefined()
  expect(board.order).toEqual([])
})

test('TaskRestored merges execution state but keeps tasks.md structure and done-state', () => {
  const stored = { ...newTask({ id: '1.1', changeId: 'demo', title: 'Old title', source: 'openspec' }), status: 'running' as const, loop: 2 }
  const running = project(evs([loaded(parsed('1.1')), { type: 'TaskRestored', task: stored }]))
  expect(running.tasks['1.1']?.status).toBe('running')
  expect(running.tasks['1.1']?.loop).toBe(2)
  expect(running.tasks['1.1']?.title).toBe('Task 1.1')
  const done = project(evs([loaded(parsed('1.1', { done: true })), { type: 'TaskRestored', task: stored }]))
  expect(done.tasks['1.1']?.status).toBe('done')
})

test('a task event stamped with another change is ignored', () => {
  const other = { ...ev({ type: 'TaskUpdated', taskId: '1.1', patch: { priority: 9 } }, 2), changeId: 'other' }
  const board = project([ev(loaded(parsed('1.1'))), other])
  expect(board.tasks['1.1']?.priority).toBe(0)
})

test('RunControl, MirrorState, ConfigWarnings and ModError set board fields', () => {
  const errors = Array.from({ length: 55 }, (_, index) => ({ type: 'ModError' as const, hook: 'h', message: `m${index}` }))
  const board = project(evs([
    { type: 'RunControl', running: true, paused: true, scope: '1.1' },
    { type: 'MirrorState', pending: true },
    { type: 'ConfigWarnings', warnings: ['implementer effort "ultra" is invalid; using medium'] },
    ...errors,
  ]))
  expect(board.running).toBe(true)
  expect(board.paused).toBe(true)
  expect(board.scope).toBe('1.1')
  expect(board.mirrorPending).toBe(true)
  expect(board.configWarnings).toHaveLength(1)
  expect(board.errors).toHaveLength(50)
  expect(board.errors.at(-1)?.message).toBe('m54')
})

test('project never mutates its input', () => {
  const events = deepFreeze(evs([
    loaded(parsed('1.1')),
    { type: 'TaskUpdated', taskId: '1.1', patch: { priority: 1 } },
    { type: 'CommentAdded', taskId: '1.1', comment: { id: 'c1', author: 'user', text: 'x' } },
  ]))
  expect(() => project(events)).not.toThrow()
})
