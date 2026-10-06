import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import type { Io } from '../runtime/io.ts'
import { newTask } from '../domain/types.ts'
import { installWorld, worldIo } from '../testing/world.ts'
import { agentSpec, registerAgentTypes, spawnRole } from './agents.ts'
import { phasePrompt } from './prompts.ts'

const task = { ...newTask({ id: '2.1', changeId: 'demo', title: 'Parse tasks', source: 'openspec', section: '2. Parser' }), allowedFiles: ['src/parse.ts'], testFiles: ['tests/parse.test.ts'] }

test('read-only roles cannot edit; every type runs in the background', () => {
  expect(agentSpec('reviewer')).toMatchObject({ name: 'reviewer', disallowedTools: ['Edit', 'Write', 'NotebookEdit'], background: true })
  expect(agentSpec('implementer', 'high')).toMatchObject({ name: 'implementer', effort: 'high' })
  expect(agentSpec('implementer')).not.toHaveProperty('disallowedTools')
})

test('the phase prompt carries the task, files, prior artifacts, failure reason, partial work and comments', () => {
  const prompt = phasePrompt({
    task, phase: 'code', attempt: 2, failureReason: 'code: tests fail: t1', partial: 'edited parse.ts',
    artifacts: [{ phase: 'plan', text: '{"approach":"split lines"}' }],
    comments: ['<zboard-comment author="user" id="c1">use the cache</zboard-comment>'],
  })
  expect(prompt).toContain('Task 2.1: Parse tasks')
  expect(prompt).toContain('Phase: code (attempt 2, loop 0)')
  expect(prompt).toContain('Allowed files: src/parse.ts')
  expect(prompt).toContain('Previous gate failure — fix this first: code: tests fail: t1')
  expect(prompt).toContain('### plan\n{"approach":"split lines"}')
  expect(prompt).toContain('edited parse.ts')
  expect(prompt).toContain('<zboard-comment author="user" id="c1">use the cache</zboard-comment>')
})

test('registerAgentTypes registers the six zboard types', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  await ((async ($: Io) => { await registerAgentTypes($); return null }))(worldIo(w))
  expect([...w.agentSpecs.keys()]).toEqual(['researcher', 'planner', 'tdd', 'implementer', 'reviewer', 'refactorer'])
})

test('spawnRole re-registers the role with its effort, then spawns with the model', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  expect(await ((($: Io) => spawnRole($, {
  role: 'implementer', prompt: 'do it', description: '2.1 code', model: 'claude-opus-5-5', effort: 'high',
})))(worldIo(w))).toEqual({ agentId: 'agent-1', model: 'claude-opus-5-5' })
  expect(w.agentSpecs.get('implementer')).toMatchObject({ effort: 'high' })
  expect(w.spawns[0]).toMatchObject({ subagentType: 'zboard:implementer', prompt: 'do it', model: 'claude-opus-5-5' })
})

test('a denied spawn is reported as a deny', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  w.spawnDeny = 'agent limit reached'
  expect(await ((($: Io) => spawnRole($, { role: 'planner', prompt: 'p', description: 'd', model: 'claude-opus-5-5' })))(worldIo(w))).toEqual({ deny: 'agent limit reached' })
})

test('zboard agent types are hidden from the model; others are offered', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  installWorld(on)
  const provider = { plugin: 'zboard', tier: 'user' as const }
  expect(await $.agent.offer({ agent: 'zboard:planner', description: 'd', source: 'plugin', provider })).toEqual({ isOffered: false })
  expect(await $.agent.offer({ agent: 'Explore', description: 'd', source: 'built-in', provider: { plugin: 'engine', tier: 'core' } })).toEqual({ isOffered: true })
})
