import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { DEBOUNCE_MS } from '../adapters/engram.ts'
import { agent, listing } from '../testing/plan.ts'
import { installWorld, worldIo } from '../testing/world.ts'
import { json, seedEngram } from '../testing/zboard.ts'
import { installPlanJobs } from './plan-jobs.ts'
import { flushPlanMirror, installPlanMirror, planTopic, resetPlanMirror } from './plan-mirror.ts'
import { recoverPlan, restoreMirrors } from './plan-recovery.ts'
import { planStop } from './plan-runner.ts'
import { appendPlan, readPlan } from './plan-store.ts'

const ctx = { options: {} }
const turns = (count: number) => Array.from({ length: count }, (_, index) => [
  { type: 'QaAsked' as const, changeId: 'a', question: `Q${index + 1}?`, options: ['A'], why: 'w' },
  { type: 'QaAnswered' as const, changeId: 'a', answer: 'A' },
]).flat()

test('after a reload the turns are intact and the running brainstormer still delivers the next question', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  installPlanJobs()
  const io = worldIo(w)
  await appendPlan(io, [...turns(4), { type: 'PlanAgentStarted', changeId: 'a', agent: agent('agent-1', { kind: 'brainstorm', finish: false }, 'brainstormer') }])
  w.alive.add('agent-1')
  await recoverPlan(io)
  expect((await readPlan(io)).changes.a?.activeAgent?.agentId).toBe('agent-1')
  await planStop(io, ctx, { agentId: 'agent-1', answer: json({ question: 'Q5?', options: ['A'], why: 'w' }) })
  const qa = (await readPlan(io)).changes.a?.qa
  expect(qa?.turns.map(turn => [turn.question, turn.answer])).toEqual([['Q1?', 'A'], ['Q2?', 'A'], ['Q3?', 'A'], ['Q4?', 'A'], ['Q5?', undefined]])
})

test('an active agent missing from the engine is recorded as interrupted and not relaunched', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const io = worldIo(w)
  await appendPlan(io, [{ type: 'PlanAgentStarted', changeId: 'a', agent: agent('agent-2', { kind: 'explain' }) }])
  await recoverPlan(io)
  const rec = (await readPlan(io)).changes.a
  expect(rec?.activeAgent).toBeUndefined()
  expect(rec?.retryable?.agentId).toBe('agent-2')
  expect(w.spawns).toEqual([])
})

test('mirrored events reach zplan/<project>/<change> after the debounce', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  installPlanMirror()
  resetPlanMirror()
  const io = worldIo(w)
  await appendPlan(io, turns(1))
  expect(w.saved).toEqual([])
  await w.clock.advance(DEBOUNCE_MS)
  const saved = w.saved.find(entry => entry.topic === planTopic('repo', 'a'))
  expect(saved?.content).toContain('"question":"Q1?"')
})

test('an Engram failure keeps the viewer working and marks the mirror pending', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  installPlanMirror()
  resetPlanMirror()
  w.engram = 'error'
  const io = worldIo(w)
  await appendPlan(io, turns(1))
  await flushPlanMirror(io)
  const board = await readPlan(io)
  expect(board.mirrorPending).toBe(true)
  expect(board.changes.a?.qa?.turns).toHaveLength(1)
})

test('a new session restores Q&A, revisions, critique and findings from the mirror', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const io = worldIo(w)
  const body = { rev: 3, updatedAt: 5, qa: { turns: [{ question: 'Q1?', options: ['A'], why: 'w', answer: 'A' }], done: false, capped: false }, revisions: [{ proposalId: 'p', artifact: 'design', commit: 'abc', at: 1 }] }
  seedEngram(w, planTopic('repo', 'a'), JSON.stringify(body))
  await appendPlan(io, [{ type: 'ChangesListed', complete: true, changes: [listing('a')] }])
  await restoreMirrors(io, ['a'])
  const rec = (await readPlan(io)).changes.a
  expect(rec?.qa?.turns).toHaveLength(1)
  expect(rec?.revisions).toEqual([{ proposalId: 'p', artifact: 'design', commit: 'abc', at: 1 }])
})
