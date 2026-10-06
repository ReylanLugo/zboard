import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { parseProjectConfig } from '../domain/config.ts'
import { emptyBoard } from '../domain/types.ts'
import { installWorld, worldIo } from '../testing/world.ts'
import { boot, setupDemo, taskOf, zboard } from '../testing/zboard.ts'
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
  expect(await zboard($, 'set 1.1 researcher opus 5.5 high')).toBe('zboard: unknown task 1.1')
})

test('/zboard set applies to the next spawn of that task only', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w, '## 1. Core\n\n- [ ] 1.1 Parse tasks\n- [ ] 1.2 Flip lines\n')
  await boot($)
  await zboard($, 'run demo/1.2')
  expect(await zboard($, 'set 1.1 researcher opus 5.5 high')).toBe('zboard: task 1.1 zboard:researcher will use opus 5.5 / high')
  expect(await zboard($, 'set 1.1 implementer opus 5.5 high')).toBe('zboard: task 1.1 zboard:implementer will use opus 5.5 / high')
  await zboard($, 'run demo')
  const byTask = (id: string) => w.spawns.find(spawn => spawn.prompt.startsWith(`Task ${id}:`))
  expect(byTask('1.1')?.model).toBe('claude-opus-5-5')
  expect(byTask('1.2')?.model).toBe('claude-sonnet-5-5')
  expect((await taskOf($, '1.1')).overrides).toEqual({ researcher: { model: 'opus 5.5', effort: 'high' }, implementer: { model: 'opus 5.5', effort: 'high' } })
})

test('/zboard set rejects unknown agents, models and efforts', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  await zboard($, 'run demo/1.1')
  expect(await zboard($, 'set 1.1 wizard opus 5.5 high')).toBe('zboard: unknown agent wizard (researcher, planner, tdd, implementer, reviewer, refactorer)')
  expect(await zboard($, 'set 1.1 reviewer gpt 9 high')).toBe('zboard: unknown model "gpt 9" (opus 5.5, sonnet 5.5, haiku 4.5)')
  expect(await zboard($, 'set 1.1 reviewer opus 5.5 ultra')).toBe('zboard: unknown effort "ultra" (low, medium, high, xhigh, max)')
})
