import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { boot, setupDemo, status, zboard } from '../testing/zboard.ts'
import { installWorld, worldIo } from '../testing/world.ts'

const FOUR = '## 1. Core\n\n- [ ] 1.1 A\n- [ ] 1.2 B\n- [ ] 1.3 C\n- [ ] 1.4 D\n'

test('opening the board without /zboard run spawns no agent', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  expect(await zboard($, '')).toBe('board opened.')
  expect(w.opened).toEqual(['zboard'])
  expect(w.spawns).toHaveLength(0)
})

test('/zboard run starts research for at most three tasks', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w, FOUR)
  await boot($)
  expect(await zboard($, 'run demo')).toBe('running demo')
  expect(w.spawns.map(spawn => spawn.subagentType)).toEqual(['zboard:researcher', 'zboard:researcher', 'zboard:researcher'])
  const board = await status($)
  expect(board.tasks.map(task => [task.id, task.status, task.phase])).toEqual([
    ['1.1', 'running', 'research'], ['1.2', 'running', 'research'], ['1.3', 'running', 'research'], ['1.4', 'ready', null],
  ])
})

test('/zboard run demo/1.2 runs only that task', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w, FOUR)
  await boot($)
  expect(await zboard($, 'run demo/1.2')).toBe('running demo/1.2')
  expect(w.spawns).toHaveLength(1)
  expect(w.spawns[0]?.prompt).toContain('Task 1.2: B')
})

test('an unknown change or label is reported and nothing spawns', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  expect(await zboard($, 'run missing')).toBe('no tasks.md for change missing')
  expect(await zboard($, 'run demo/7.7')).toBe('unknown task 7.7 in demo')
  expect(w.spawns).toHaveLength(0)
})

test('a denied spawn blocks the task and shows the reason', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  w.spawnDeny = 'agent limit reached'
  await boot($)
  await zboard($, 'run demo')
  expect((await status($)).tasks[0]).toMatchObject({ id: '1.1', status: 'blocked', statusReason: 'spawn denied: agent limit reached' })
})

test('with no configuration the researcher runs on sonnet 5.5 at medium effort', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  await zboard($, 'run demo')
  expect(w.spawns[0]?.model).toBe('claude-sonnet-5-5')
  expect(w.agentSpecs.get('researcher')).toMatchObject({ effort: 'medium' })
  expect((await status($)).tasks[0]?.agents[0]).toMatchObject({ agentType: 'zboard:researcher', model: 'claude-sonnet-5-5', effort: 'medium' })
})

test('a changed global picker is used by the next spawn', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS, options: { researcherModel: 'opus 5.5', researcherEffort: 'max' } }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  await zboard($, 'run demo')
  expect(w.spawns[0]?.model).toBe('claude-opus-5-5')
  expect(w.agentSpecs.get('researcher')).toMatchObject({ effort: 'max' })
})

test('a malformed project config warns and the board keeps running', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  w.files.set('/repo/.zboard/config.json', '{ not json')
  await boot($)
  await zboard($, 'run demo')
  expect((await status($)).warnings).toEqual(['.zboard/config.json is not valid JSON; ignoring it'])
  expect(w.spawns).toHaveLength(1)
})

test('the concurrency option limits how many tasks start', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS, options: { concurrency: 1 } }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w, FOUR)
  await boot($)
  await zboard($, 'run demo')
  expect(w.spawns).toHaveLength(1)
})

test('pause is reported and recorded; an unknown subcommand prints usage', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  expect(await zboard($, 'pause')).toBe('nothing is running.')
  await zboard($, 'run demo')
  expect(await zboard($, 'pause')).toBe('paused. In-flight phases finish; no new phase starts until /zboard run.')
  expect((await status($)).paused).toBe(true)
  expect(await zboard($, 'dance')).toStartWith('unknown subcommand "dance".')
})
