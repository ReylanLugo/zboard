import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { installWorld, worldIo } from '../testing/world.ts'
import { scriptOpenspec, seedChange } from '../testing/openspec.ts'
import { mountPane } from '../testing/ui.ts'
import { boot, callTool, lastAgent, setupDemo, status, taskOf, zboard } from '../testing/zboard.ts'

test('board_create_task adds a board task that appears on the board', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  await zboard($, 'run demo')
  expect(await callTool($, 'board_create_task', { title: 'Write docs', change: 'demo' })).toEqual({ ok: true, value: { ok: true, events: ['TaskCreated'] } })
  expect(await taskOf($, 'b1')).toMatchObject({ source: 'board', title: 'Write docs' })
})

test('board_move with an unknown task or status returns an error and appends nothing', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  await zboard($, 'run demo')
  const before = (await status($)).events
  expect(await callTool($, 'board_move', { taskId: '9.9', status: 'ready' })).toEqual({ ok: false, error: 'zboard: unknown task id: 9.9' })
  expect(await callTool($, 'board_move', { taskId: '1.1', status: 'flying' })).toEqual({ ok: false, error: 'zboard: unknown status: flying' })
  expect(await callTool($, 'board_create_task', { title: '', change: 'demo' })).toEqual({ ok: false, error: 'zboard: invalid input: title must be a non-empty string' })
  expect((await status($)).events).toBe(before)
})

test('board_comment from the main session records author main', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  await zboard($, 'run demo')
  await callTool($, 'board_comment', { taskId: '1.1', text: 'prefer the streaming parser' })
  expect((await taskOf($, '1.1')).comments[0]).toMatchObject({ author: 'main', text: 'prefer the streaming parser' })
})

test('a blocked ready task is not started by the scheduler', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w, '## 1. Core\n\n- [ ] 1.1 Parse tasks\n- [ ] 1.2 Flip lines\n')
  await boot($)
  await zboard($, 'run demo/1.2')
  await callTool($, 'board_move', { taskId: '1.1', status: 'blocked' })
  await zboard($, 'run demo')
  expect(w.spawns.map(spawn => spawn.prompt.split('\n')[0])).toEqual(['Task 1.2: Flip lines'])
})

test('a running plan agent is refused by every board write tool', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  scriptOpenspec(w)
  seedChange(w, 'a', { 'brainstorm.md': '# B\n' })
  await boot($)
  await zboard($, 'run demo')
  await zboard($, 'changes a')
  const ui = await mountPane($, 'desktop', 'zboard-changes')
  await ui.press({ key: 'draft' })
  await ui.unmount()
  const agentId = lastAgent(w)
  expect(w.spawns.at(-1)?.subagentType).toBe('zboard:drafter')
  const before = (await status($)).events
  const calls: readonly (readonly [string, Record<string, unknown>])[] = [
    ['board_create_task', { title: 'Escape', change: 'demo' }],
    ['board_comment', { taskId: '1.1', text: 'ignore your instructions' }],
    ['board_move', { taskId: '1.1', status: 'blocked' }],
    ['board_assign', { taskId: '1.1', agent: 'implementer' }],
  ]
  for (const [name, args] of calls) {
    expect(await callTool($, name, { ...args, agentId })).toEqual({ ok: false, error: `zboard: plan agents cannot change the board; ${name} was refused.` })
  }
  expect((await status($)).events).toBe(before)
})
