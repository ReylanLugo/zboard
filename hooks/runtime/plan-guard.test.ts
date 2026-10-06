import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { agent } from '../testing/plan.ts'
import { installWorld, worldIo } from '../testing/world.ts'
import { guardWrite } from './guard.ts'
import { appendPlan } from './plan-store.ts'

test('a running plan agent cannot write; other agents are not affected', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const io = worldIo(w)
  await appendPlan(io, [{ type: 'PlanAgentStarted', changeId: 'a', agent: agent('agent-7', { kind: 'draft', artifact: 'proposal' }, 'drafter') }])
  expect(await guardWrite(io, 'agent-7', '/repo/openspec/changes/a/proposal.md')).toBe('zboard: plan agents are read-only; /repo/openspec/changes/a/proposal.md was not changed.')
  expect(await guardWrite(io, 'agent-8', '/repo/src/x.ts')).toBeUndefined()
  expect(await guardWrite(io, undefined, '/repo/src/x.ts')).toBeUndefined()
})
