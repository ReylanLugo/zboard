import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { installWorld, worldIo } from '../testing/world.ts'
import { planAgentSpec, registerPlanAgentTypes, spawnPlanRole } from './agents.ts'

test('plan agents are read-only, never run commands and run in the background', () => {
  expect(planAgentSpec('drafter', 'medium')).toMatchObject({
    name: 'drafter', background: true, effort: 'medium',
  })
  expect(planAgentSpec('drafter').disallowedTools).toEqual([
    'Edit', 'Write', 'NotebookEdit', 'Bash',
    'mcp__zboard__board_create_task', 'mcp__zboard__board_comment', 'mcp__zboard__board_move', 'mcp__zboard__board_assign',
    'mcp__engram__mem_save',
  ])
})

test('registerPlanAgentTypes registers the five plan types', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  await registerPlanAgentTypes(worldIo(w))
  expect([...w.agentSpecs.keys()]).toEqual(['brainstormer', 'drafter', 'explainer', 'critic', 'judge'])
})

test('spawnPlanRole re-registers the role with its model and effort, then spawns zboard:<role> without a model argument', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const out = await spawnPlanRole(worldIo(w), { role: 'drafter', prompt: 'draft', description: 'zboard drafter for a', model: 'claude-sonnet-5-5', effort: 'medium' })
  expect(out).toEqual({ agentId: 'agent-1', model: 'claude-sonnet-5-5' })
  expect(w.agentSpecs.get('drafter')).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'medium' })
  expect(w.spawns[0]).toMatchObject({ subagentType: 'zboard:drafter', prompt: 'draft' })
  expect(w.spawns[0]).not.toHaveProperty('model')
})

test('the plan agent types are hidden from the model', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  installWorld(on)
  const provider = { plugin: 'zboard', tier: 'user' as const }
  for (const agent of ['zboard:brainstormer', 'zboard:drafter', 'zboard:explainer', 'zboard:critic', 'zboard:judge']) {
    expect(await $.agent.offer({ agent, description: 'd', source: 'plugin', provider })).toEqual({ isOffered: false })
  }
})
