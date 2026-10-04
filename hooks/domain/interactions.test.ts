import { expect, test } from 'claude-code/testing'

import { evs, loaded, parsed } from '../testing/factories.ts'
import { addComment, assignTask, createTask, moveTask, raisePriority, toggleBlock } from './interactions.ts'
import { project } from './project.ts'

const board = project(evs([
  loaded(parsed('1.1'), parsed('1.2')),
  { type: 'TaskStatusChanged', taskId: '1.2', from: 'ready', to: 'running' },
]))

test('createTask creates a board task in the loaded change only', () => {
  expect(createTask(board, 'demo', 'Write docs')).toEqual({
    ok: true, events: [{ type: 'TaskCreated', task: { id: 'b1', title: 'Write docs', source: 'board', section: 'Board', description: 'Write docs' } }],
  })
  expect(createTask(board, 'other', 'x')).toEqual({ ok: false, error: 'change other is not loaded (the board shows demo)' })
})

test('comments are trimmed, bounded and never empty', () => {
  expect(addComment(board, '1.1', 'user', '  use the cache  ', 7)).toEqual({
    ok: true, events: [{ type: 'CommentAdded', taskId: '1.1', comment: { id: '1.1#1-7', author: 'user', text: 'use the cache' } }],
  })
  expect(addComment(board, '1.1', 'user', '   ', 7)).toEqual({ ok: false, error: 'comment is empty' })
  expect(addComment(board, '9.9', 'user', 'x', 7)).toEqual({ ok: false, error: 'unknown task id: 9.9' })
  expect(addComment(board, '1.1', 'user', 'x'.repeat(4_001), 7)).toEqual({ ok: false, error: 'comment is longer than 4000 characters' })
})

test('block toggles ready ↔ blocked and refuses other states', () => {
  expect(toggleBlock(board, '1.1')).toEqual({ ok: true, events: [{ type: 'TaskStatusChanged', taskId: '1.1', from: 'ready', to: 'blocked', reason: 'blocked by user' }] })
  const blocked = project(evs([loaded(parsed('1.1')), { type: 'TaskStatusChanged', taskId: '1.1', from: 'ready', to: 'blocked' }]))
  expect(toggleBlock(blocked, '1.1')).toEqual({ ok: true, events: [{ type: 'TaskStatusChanged', taskId: '1.1', from: 'blocked', to: 'ready', reason: 'unblocked by user' }] })
  expect(toggleBlock(board, '1.2')).toEqual({ ok: false, error: 'task 1.2 is running; only ready or blocked tasks can be blocked or unblocked' })
})

test('raisePriority adds one; moveTask and assignTask validate their inputs', () => {
  expect(raisePriority(board, '1.1')).toEqual({ ok: true, events: [{ type: 'TaskUpdated', taskId: '1.1', patch: { priority: 1 } }] })
  expect(moveTask(board, '1.1', 'flying')).toEqual({ ok: false, error: 'unknown status: flying' })
  expect(moveTask(board, '1.1', 'done')).toEqual({ ok: false, error: 'an openspec task can only move to ready or blocked; done comes from the pipeline' })
  expect(moveTask(board, '1.1', 'blocked')).toMatchObject({ ok: true })
  expect(assignTask(board, '1.1', 'wizard')).toEqual({ ok: false, error: 'unknown agent: wizard' })
  expect(assignTask(board, '1.1', 'reviewer')).toEqual({ ok: true, events: [{ type: 'TaskUpdated', taskId: '1.1', patch: { assignee: 'zboard:reviewer' } }] })
})

test('moveTask refuses an openspec task the pipeline is running or reviewing', () => {
  expect(moveTask(board, '1.2', 'blocked')).toEqual({ ok: false, error: 'task 1.2 is running; the pipeline owns it until its phase ends' })
  expect(moveTask(board, '1.2', 'ready')).toEqual({ ok: false, error: 'task 1.2 is running; the pipeline owns it until its phase ends' })
  const reviewing = project(evs([loaded(parsed('1.1')), { type: 'TaskStatusChanged', taskId: '1.1', from: 'ready', to: 'review' }]))
  expect(moveTask(reviewing, '1.1', 'blocked')).toEqual({ ok: false, error: 'task 1.1 is review; the pipeline owns it until its phase ends' })
})
