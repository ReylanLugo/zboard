import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { TIMER_SPAWN, installWorld, worldIo } from '../testing/world.ts'
import { TASKS_PATH, TWO_TASKS, boot, setupDemo, zboard } from '../testing/zboard.ts'
import type { Frame } from './frame.ts'
import { openFrame, outsideFrame, withinFrame } from './frame.ts'
import { drainPressWork, pressWork } from './press-work.ts'
import { POLL_MS } from './watcher.ts'

test('a frame is open while its work runs and closes once the work settles, even when it throws', async () => {
  let seen: Frame | undefined
  expect(await withinFrame('turn.complete', async frame => { seen = frame; return frame.isOpen() })).toBe(true)
  expect(seen?.isOpen()).toBe(false)
  await expect(withinFrame('ui.press', async frame => { seen = frame; throw new Error('boom') })).rejects.toThrow('boom')
  expect(seen?.isOpen()).toBe(false)
  const frame = openFrame('ui.render')
  frame.close()
  expect(frame.isOpen()).toBe(false)
  expect(outsideFrame('ui.render')).toContain('the ui.render hook had settled')
})

test('the world refuses a spawn made from a timer callback, as the engine would strip its hooks', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async (_$, on) => {
  const w = installWorld(on)
  const io = worldIo(w)
  const answers: unknown[] = []
  io.clock.after(0, () => {
    void io.agent.spawn({ prompt: 'p', subagentType: 'zboard:researcher' } as never).then(answer => answers.push(answer))
  })
  await w.clock.advance(0)
  expect(answers).toEqual([{ deny: TIMER_SPAWN }])
  expect(w.timerSpawns).toEqual(['zboard:researcher'])
  expect(w.spawns).toEqual([])
})

test('queued press work runs in order with the draining hook\'s ports; a failure does not stop the rest', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async (_$, on) => {
  const w = installWorld(on)
  const io = worldIo(w)
  const ran: string[] = []
  pressWork(async () => { throw new Error('first failed') })
  pressWork(async ports => { ran.push(ports === io ? 'same ports' : 'other ports') })
  await drainPressWork(io)
  await drainPressWork(io)
  expect(ran).toEqual(['same ports'])
  expect(w.debug).toEqual(["zboard: a press's work failed: first failed"])
})

test('a tasks.md poll never spawns from its timer; the next turn.complete starts the new task', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  await zboard($, 'run demo')
  w.files.set(TASKS_PATH, TWO_TASKS)
  await w.clock.advance(POLL_MS)
  expect(w.spawns.map(spawn => spawn.prompt.split('\n')[0])).toEqual(['Task 1.1: Parse tasks'])
  expect(w.timerSpawns).toEqual([])
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 'main', reason: 'answer' })
  expect(w.spawns.map(spawn => spawn.prompt.split('\n')[0])).toEqual(['Task 1.1: Parse tasks', 'Task 1.2: Flip lines'])
})
