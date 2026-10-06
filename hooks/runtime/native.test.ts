import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import type { On } from 'claude-code'
import { project } from '../domain/project.ts'
import { evs } from '../testing/factories.ts'
import { installWorld, worldIo } from '../testing/world.ts'
import { boot, status, taskOf } from '../testing/zboard.ts'
import { nativeUpdate } from './native.ts'

function nativeTools(on: On): void {
  let next = 7
  on('tool.call', { tool: 'TaskCreate' }, (_$, e) => {
    const id = String(next++)
    return { result: { task: { id, subject: e.subject } }, text: `Task #${id} created successfully: ${e.subject}` }
  })
  on('tool.call', { tool: 'TaskUpdate' }, (_$, e) => ({ result: { success: true, taskId: e.taskId, updatedFields: ['status'] }, text: `Updated task #${e.taskId}` }))
}

test('nativeUpdate maps status, dependencies and deletion', () => {
  const board = project(evs([
    { type: 'TaskCreated', task: { id: 'n7', title: 'A', source: 'native' } },
    { type: 'TaskCreated', task: { id: 'n8', title: 'B', source: 'native' } },
  ]))
  expect(nativeUpdate(board, 'n7', { status: 'in_progress', addBlockedBy: ['8'] })).toEqual([
    { type: 'TaskUpdated', taskId: 'n7', patch: { dependsOn: ['n8'] } },
    { type: 'TaskStatusChanged', taskId: 'n7', from: 'ready', to: 'running' },
  ])
  expect(nativeUpdate(board, 'n8', { addBlocks: ['7'] })).toEqual([{ type: 'TaskUpdated', taskId: 'n7', patch: { dependsOn: ['n8'] } }])
  expect(nativeUpdate(board, 'n7', { status: 'deleted' })).toEqual([{ type: 'TaskRemoved', taskId: 'n7' }])
  expect(nativeUpdate(board, 'n99', { status: 'completed' })).toEqual([])
})

test('a native TaskCreate appears as a native task and its result is unchanged', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  installWorld(on)
  nativeTools(on)
  await boot($)
  const out = await $.tool.call({ tool: 'TaskCreate', subject: 'Write docs', description: 'README' })
  expect(out.text).toBe('Task #7 created successfully: Write docs')
  expect(out.result).toEqual({ task: { id: '7', subject: 'Write docs' } })
  expect(await taskOf($, 'n7')).toMatchObject({ source: 'native', title: 'Write docs', status: 'ready' })
})

test('TaskUpdate completed makes the mirrored task done; deleted removes it', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  installWorld(on)
  nativeTools(on)
  await boot($)
  await $.tool.call({ tool: 'TaskCreate', subject: 'A', description: 'a' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'B', description: 'b' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'completed' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '8', status: 'deleted' })
  expect((await status($)).tasks.map(task => [task.id, task.status])).toEqual([['n7', 'done']])
})

test('an update for a task zboard never mirrored appends nothing', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  installWorld(on)
  nativeTools(on)
  await boot($)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '42', status: 'completed' })
  expect((await status($)).events).toBe(0)
})
