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

test('world: the Agent tool accepts only model aliases and otherwise runs the definition model', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const rejected = await $.agent.spawn({ ...spawnInput('p', 'zboard:drafter'), model: 'claude-opus-5-5' })
  expect(rejected.deny).toContain('<tool_use_error>InputValidationError:')
  expect(rejected.deny).toContain("received 'claude-opus-5-5'")
  expect(w.spawns).toHaveLength(0)
  expect((await $.agent.spawn({ ...spawnInput('p', 'zboard:drafter'), model: 'opus' })).model).toBe('opus')
  await worldIo(w).agent.register({ name: 'critic', description: 'd', prompt: 'p', model: 'claude-sonnet-5-5' })
  expect(await worldIo(w).agent.spawn({ prompt: 'p', subagentType: 'zboard:critic' })).toMatchObject({ model: 'claude-sonnet-5-5', agentId: 'agent-2' })
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
