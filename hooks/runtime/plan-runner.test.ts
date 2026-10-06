import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { parseCritique } from '../plan/contracts.ts'
import { agent } from '../testing/plan.ts'
import { installWorld, worldIo } from '../testing/world.ts'
import { json, lastAgent } from '../testing/zboard.ts'
import type { Io } from './io.ts'
import { TOKENS_KEY, defineJob, planStop, planTokens, retryJob, startJob } from './plan-runner.ts'
import { appendPlan, readPlan } from './plan-store.ts'

const ctx = { options: {} }
const CRITIQUE = json({ findings: [{ severity: 'high', artifact: 'design', issue: 'no rollback', suggestion: 'add one' }] })

/** A stand-in critique handler; the real one arrives in Task 6.2. Defined per test so another file's handlers never leak in. */
function useFakeCritique(): void {
  defineJob('critique', {
    prompt: async (_io: Io, changeId, _job, gateReason) => `critique ${changeId}${gateReason === undefined ? '' : ` | retry: ${gateReason}`}`,
    parse: parseCritique,
    done: async (io, _ctx, changeId, _job, value) => { await appendPlan(io, [{ type: 'CritiqueRecorded', changeId, findings: value.findings }]) },
  })
}

test('one agent per change: a second start is refused and nothing more spawns', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  useFakeCritique()
  const io = worldIo(w)
  expect(await startJob(io, ctx, 'a', { kind: 'critique' })).toBe(true)
  expect(await startJob(io, ctx, 'a', { kind: 'critique' })).toBe(false)
  expect(w.spawns).toHaveLength(1)
  expect(w.toasts).toEqual(['zboard: an agent is already running for a'])
})

test('concurrent starts for one change spawn once', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  useFakeCritique()
  const io = worldIo(w)
  expect(await Promise.all([startJob(io, ctx, 'a', { kind: 'critique' }), startJob(io, ctx, 'a', { kind: 'critique' })])).toEqual([true, false])
  expect(w.spawns).toHaveLength(1)
})

test('the spawn uses the resolved model and effort', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  useFakeCritique()
  w.files.set('/repo/.zboard/config.json', '{"agents":{"critic":{"model":"sonnet 5.5","effort":"medium"}}}')
  await startJob(worldIo(w), ctx, 'a', { kind: 'critique' })
  expect(w.spawns[0]).toMatchObject({ subagentType: 'zboard:critic', model: 'claude-sonnet-5-5', prompt: 'critique a' })
  expect(w.agentSpecs.get('critic')).toMatchObject({ effort: 'medium' })
  expect((await readPlan(worldIo(w))).changes.a?.activeAgent).toMatchObject({ agentId: 'agent-1', role: 'critic', attempt: 1, model: 'sonnet 5.5' })
})

test('a valid answer frees the slot and reaches the handler', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  useFakeCritique()
  const io = worldIo(w)
  await startJob(io, ctx, 'a', { kind: 'critique' })
  await planStop(io, ctx, { agentId: lastAgent(w), answer: CRITIQUE })
  const rec = (await readPlan(io)).changes.a
  expect(rec?.activeAgent).toBeUndefined()
  expect(rec?.critique).toEqual([{ severity: 'high', artifact: 'design', issue: 'no rollback', suggestion: 'add one' }])
})

test('an invalid answer is retried once with the reason; a second failure is recorded and retryable', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  useFakeCritique()
  const io = worldIo(w)
  await startJob(io, ctx, 'a', { kind: 'critique' })
  await planStop(io, ctx, { agentId: lastAgent(w), answer: 'Looks fine to me.' })
  expect(w.spawns).toHaveLength(2)
  expect(w.spawns[1]?.prompt).toBe('critique a | retry: no valid ```json block with an object')
  await planStop(io, ctx, { agentId: lastAgent(w) })
  expect(w.spawns).toHaveLength(2)
  const rec = (await readPlan(io)).changes.a
  expect(rec?.errors.at(-1)?.message).toBe('critic gave no valid answer twice: the agent gave no answer')
  expect(rec?.critique).toBeUndefined()
  expect(rec?.retryable?.job).toEqual({ kind: 'critique' })
  expect(await retryJob(io, ctx, 'a')).toBe(true)
  expect(w.spawns).toHaveLength(3)
})

test('a stop of an agent zboard did not start is ignored', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  useFakeCritique()
  const io = worldIo(w)
  await planStop(io, ctx, { agentId: 'someone-else', answer: CRITIQUE })
  expect((await readPlan(io)).order).toEqual([])
})

test('a denied spawn is recorded on the change', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  useFakeCritique()
  w.spawnDeny = 'agent limit reached'
  const io = worldIo(w)
  expect(await startJob(io, ctx, 'a', { kind: 'critique' })).toBe(false)
  expect((await readPlan(io)).changes.a?.errors.map(e => [e.hook, e.message])).toEqual([['spawn.critic', 'agent limit reached']])
})

test('drafter turns are kept as token history for the forecast', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const io = worldIo(w)
  await appendPlan(io, [{ type: 'PlanAgentStarted', changeId: 'a', agent: agent('agent-9', { kind: 'draft', artifact: 'plan' }, 'drafter') }])
  await planTokens(io, 'agent-9', { input_tokens: 1_000, output_tokens: 500 })
  await planTokens(io, 'not-a-plan-agent', { input_tokens: 5 })
  expect(w.store.get(TOKENS_KEY)).toEqual([1_500])
})
