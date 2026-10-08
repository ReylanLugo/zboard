import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { parseProjectConfig } from '../domain/config.ts'
import { emptyBoard } from '../domain/types.ts'
import { installWorld, worldIo } from '../testing/world.ts'
import { boot, setupDemo, status, taskOf, zboard } from '../testing/zboard.ts'
import { configLines } from './config-view.ts'

test('config lines show each agent value with the level that provided it', () => {
  const project = parseProjectConfig('{"agents":{"reviewer":{"model":"opus 5.5","effort":"max"}}}')
  const lines = configLines(project, { implementerEffort: 'high' }, emptyBoard(null))
  expect(lines).toContain('zboard:reviewer: opus 5.5 (project) / max (project)')
  expect(lines).toContain('zboard:implementer: sonnet 5.5 (default) / high (global)')
  expect(lines).toContain('zboard:planner: opus 5.5 (default) / xhigh (default)')
  expect(lines).toContain('auto-escalation: off')
})

test('/zboard config prints the effective configuration with sources', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  w.files.set('/repo/.zboard/config.json', '{"agents":{"reviewer":{"model":"opus 5.5","effort":"max"},"implementer":{"effort":"ultra"}}}')
  await boot($)
  const text = await zboard($, 'config')
  expect(text).toContain('zboard:reviewer: opus 5.5 (project) / max (project)')
  expect(text).toContain('⚠ project implementer effort "ultra" is invalid; using medium')
})

test('/zboard set before any change is loaded names the unknown task', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  installWorld(on)
  await boot($)
  expect(await zboard($, 'set 1.1 researcher opus 5.5 high')).toBe('unknown task 1.1')
})

test('/zboard set applies to the next spawn of that task only', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w, '## 1. Core\n\n- [ ] 1.1 Parse tasks\n- [ ] 1.2 Flip lines\n')
  await boot($)
  await zboard($, 'run demo/1.2')
  expect(await zboard($, 'set 1.1 researcher opus 5.5 high')).toBe('task 1.1 zboard:researcher will use opus 5.5 / high')
  expect(await zboard($, 'set 1.1 implementer opus 5.5 high')).toBe('task 1.1 zboard:implementer will use opus 5.5 / high')
  await zboard($, 'run demo')
  const byTask = (id: string) => w.spawns.find(spawn => spawn.prompt.startsWith(`Task ${id}:`))
  const runOf = async (id: string) => (await status($)).tasks.find(task => task.id === id)?.agents.find(run => run.agentId === byTask(id)?.agentId)
  expect((await runOf('1.1'))?.model).toBe('claude-opus-5-5')
  expect((await runOf('1.2'))?.model).toBe('claude-sonnet-5-5')
  expect((await taskOf($, '1.1')).overrides).toEqual({ researcher: { model: 'opus 5.5', effort: 'high' }, implementer: { model: 'opus 5.5', effort: 'high' } })
})

test('/zboard set rejects unknown agents, models and efforts', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  await zboard($, 'run demo/1.1')
  expect(await zboard($, 'set 1.1 wizard opus 5.5 high')).toBe('unknown agent wizard (researcher, planner, tdd, implementer, reviewer, refactorer)')
  expect(await zboard($, 'set 1.1 reviewer gpt 9 high')).toBe('unknown model "gpt 9" (opus 5.5, sonnet 5.5, haiku 4.5)')
  expect(await zboard($, 'set 1.1 reviewer opus 5.5 ultra')).toBe('unknown effort "ultra" (low, medium, high, xhigh, max)')
})

test('config lines show the default ptest test command when none is configured', () => {
  expect(configLines(parseProjectConfig(undefined), {}, emptyBoard(null))).toContain('test command: ["ptest","{file}"] (default (ptest))')
})

test('/zboard config prints the project test command with its timeout', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  w.files.set('/repo/.zboard/config.json', '{"testCommand":["uv","run","pytest","{file}"],"testTimeoutMs":120000}')
  await boot($)
  expect(await zboard($, 'config')).toContain('test command: ["uv","run","pytest","{file}"] (project), timeout 120000 ms')
})

test('/zboard config prints the ptest fallback and the warning for an invalid test command', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  w.files.set('/repo/.zboard/config.json', '{"testCommand":[]}')
  await boot($)
  const text = await zboard($, 'config')
  expect(text).toContain('test command: ["ptest","{file}"] (default (ptest))')
  expect(text).toContain('⚠ .zboard/config.json: testCommand must be a non-empty array of non-empty strings')
})
