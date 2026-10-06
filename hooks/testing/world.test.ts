import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from './timeouts.ts'

import { absPath, argvIs, installWorld, spawnInput, worldIo } from './world.ts'

test('world: absPath resolves relative and dotted paths under the root', () => {
  expect(absPath('src/a.ts')).toBe('/repo/src/a.ts')
  expect(absPath('/repo/src/../b.ts')).toBe('/repo/b.ts')
  expect(absPath('./x/./y')).toBe('/repo/x/y')
})

test('world: Engram saves upsert by topic and are searchable by id', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  await $.tool.call({ tool: 'mcp__engram__mem_save', title: 't', topic_key: 'zboard/p/c/1.1', content: 'one' })
  await $.tool.call({ tool: 'mcp__engram__mem_save', title: 't', topic_key: 'zboard/p/c/1.1', content: 'two' })
  expect(w.saved).toHaveLength(1)
  const found = await $.tool.call({ tool: 'mcp__engram__mem_search', query: 'zboard/p/c/1.1' })
  expect(found.text).toContain('#1')
  const got = await $.tool.call({ tool: 'mcp__engram__mem_get_observation', id: 1 })
  expect(got.text).toContain('two')
})

test('world: spawn mints agent ids and honours spawnDeny', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  await $.agent.spawn(spawnInput('p', 'zboard:researcher'))
  expect(w.spawns[0]?.agentId).toBe('agent-1')
  w.spawnDeny = 'no agents today'
  const second = await $.agent.spawn(spawnInput('p', 'zboard:planner'))
  expect(second.deny).toBe('no agents today')
})

test('world: worldIo answers adapter code as the hooks answer the plugin', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async (_$, on) => {
  const w = installWorld(on)
  w.rules.push({ match: argvIs('git', 'status'), answer: { exitCode: 0, stdout: 'clean' } })
  const io = worldIo(w)
  await io.fs.write('notes/a.txt', 'hello')
  const ran = await io.process.run(['git', 'status'])
  expect({ text: await io.fs.read('notes/a.txt'), code: ran.exitCode, out: ran.stdout }).toEqual({ text: 'hello', code: 0, out: 'clean' })
  expect(w.files.get('/repo/notes/a.txt')).toBe('hello')
})
