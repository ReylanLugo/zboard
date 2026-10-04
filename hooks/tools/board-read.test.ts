import { expect, test } from 'claude-code/testing'

import { boot, callTool, status } from '../testing/zboard.ts'
import { installWorld } from '../testing/world.ts'

test('the four read tools are registered at session start', async ($, on) => {
  const w = installWorld(on)
  await boot($)
  expect(w.tools).toEqual(expect.arrayContaining(['board_status', 'board_task', 'board_artifact', 'board_agent']))
})

test('board_status on an empty board reports no change and appends nothing', async ($, on) => {
  installWorld(on)
  await boot($)
  const first = await status($)
  const second = await status($)
  expect(first).toMatchObject({ change: null, tasks: [], events: 0, errors: [] })
  expect(second.events).toBe(0)
})

test('board_task, board_agent and board_artifact name an unknown id', async ($, on) => {
  installWorld(on)
  await boot($)
  expect(await callTool($, 'board_task', { taskId: '9.9' })).toEqual({ ok: false, error: 'unknown task id: 9.9' })
  expect(await callTool($, 'board_agent', { agentId: 'a9' })).toEqual({ ok: false, error: 'unknown agent id: a9' })
  expect(await callTool($, 'board_artifact', { taskId: '9.9', phase: 'plan' })).toEqual({ ok: false, error: 'unknown task id: 9.9' })
})
