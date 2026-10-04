import { expect, test } from 'claude-code/testing'

import { newTask } from '../domain/types.ts'
import { installWorld, worldIo } from '../testing/world.ts'
import { TASKS_PATH, agentOf, boot, seedEngram, setupDemo, status, zboard } from '../testing/zboard.ts'

const seedSession = (w: Parameters<typeof seedEngram>[0], task: object): void => {
  seedEngram(w, 'zboard/repo/active', JSON.stringify({ rev: 1, updatedAt: 5, change: 'demo' }))
  seedEngram(w, 'zboard/repo/demo/index', JSON.stringify({ rev: 2, updatedAt: 5, running: true, paused: false, tasks: ['1.1'] }))
  seedEngram(w, 'zboard/repo/demo/1.1', JSON.stringify({ rev: 3, updatedAt: 5, task }))
}

test('after compaction a running phase whose agent is gone is interrupted and relaunched with partial work', async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  await zboard($, 'run demo')
  w.alive.delete('agent-1')
  await $.classic.PostCompact({ trigger: 'auto', compact_summary: 'summary' })
  expect(await agentOf($, 'agent-1')).toMatchObject({ outcome: 'interrupted' })
  expect(w.spawns[1]).toMatchObject({ subagentType: 'zboard:researcher' })
  expect(w.spawns[1]?.prompt).toContain('## Partial work from an interrupted run')
})

test('a fresh session restores the board from tasks.md and Engram, and tasks.md done-state wins', async ($, on) => {
  const w = installWorld(on)
  setupDemo(w, '## 1. Core\n\n- [x] 1.1 Parse tasks\n')
  const running = { ...newTask({ id: '1.1', changeId: 'demo', title: 'Parse tasks', source: 'openspec' }), status: 'running', loop: 1 }
  seedSession(w, running)
  await boot($)
  const board = await status($)
  expect(board.change).toBe('demo')
  expect(board.tasks[0]).toMatchObject({ id: '1.1', status: 'done', loop: 1 })
  expect(w.spawns).toHaveLength(0)
})

test('the board opens unasked after recovery and is not forced on a narrow terminal', async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  w.placePanes = false
  seedSession(w, newTask({ id: '1.1', changeId: 'demo', title: 'Parse tasks', source: 'openspec' }))
  await boot($)
  expect(w.opened).toEqual(['zboard'])
})

test('several events within 10 s are mirrored once after the debounce window', async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  await zboard($, 'run demo')
  expect(w.saved.filter(saved => saved.topic === 'zboard/repo/demo/1.1')).toHaveLength(0)
  await w.clock.advance(10_000)
  expect(w.saved.filter(saved => saved.topic === 'zboard/repo/demo/1.1')).toHaveLength(1)
})

test('PreCompact flushes pending writes at once', async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  await zboard($, 'run demo')
  await $.classic.PreCompact({ trigger: 'manual', custom_instructions: null })
  expect(w.saved.map(saved => saved.topic)).toContain('zboard/repo/demo/1.1')
})

test('with Engram down the pipeline continues, the board shows mirror pending, and the next flush retries', async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  w.engram = 'error'
  await boot($)
  await zboard($, 'run demo')
  await $.classic.PreCompact({ trigger: 'manual', custom_instructions: null })
  expect((await status($)).mirrorPending).toBe(true)
  expect(w.spawns).toHaveLength(1)
  w.engram = 'up'
  await $.classic.PreCompact({ trigger: 'manual', custom_instructions: null })
  expect((await status($)).mirrorPending).toBe(false)
})

test('a task added to tasks.md appears within one poll interval', async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  await zboard($, 'run demo')
  w.files.set(TASKS_PATH, '## 1. Core\n\n- [ ] 1.1 Parse tasks\n\n## 3. Later\n\n- [ ] 3.4 New task\n')
  await w.clock.advance(5_000)
  expect((await status($)).tasks.map(task => task.id)).toEqual(['1.1', '3.4'])
})

test('FileChanged on tasks.md reconciles at once', async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  await zboard($, 'run demo')
  w.files.set(TASKS_PATH, '## 1. Core\n\n- [ ] 1.1 Parse tasks\n- [ ] 1.2 Flip lines\n')
  await $.classic.FileChanged({ file_path: TASKS_PATH, event: 'change' })
  expect((await status($)).tasks.map(task => task.id)).toEqual(['1.1', '1.2'])
})

test('SessionStart asks the engine to watch the active tasks.md (spike)', async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  await zboard($, 'run demo')
  const result = await $.classic.SessionStart({ source: 'resume' })
  expect(result.watchPaths).toEqual([TASKS_PATH])
})
