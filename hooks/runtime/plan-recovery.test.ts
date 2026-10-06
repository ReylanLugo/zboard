import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { DEBOUNCE_MS } from '../adapters/engram.ts'
import { actionsFor } from '../plan/lifecycle.ts'
import { agent, listing, marks } from '../testing/plan.ts'
import { installWorld, worldIo } from '../testing/world.ts'
import { json, seedEngram } from '../testing/zboard.ts'
import { installPlanJobs } from './plan-jobs.ts'
import { flushPlanMirror, installPlanMirror, planTopic, resetPlanMirror } from './plan-mirror.ts'
import { parseMirror, recoverPlan, restoreMirrors } from './plan-recovery.ts'
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

test('a restored verify run never passes; only a fresh verify in this session can', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const io = worldIo(w)
  const verify = { runs: 1, passed: true, findings: [
    { id: 'r:export-csv', requirement: 'Export CSV', verdict: 'true', evidence: ['src/export.ts:3'] },
    { id: 'r:import-csv', requirement: 'Import CSV', verdict: 'no_evidence', evidence: ['none'], resolution: 'accepted' },
  ] }
  seedEngram(w, planTopic('repo', 'a'), JSON.stringify({ rev: 1, updatedAt: 1, revisions: [], verify }))
  await appendPlan(io, [{ type: 'ChangesListed', complete: true, changes: [listing('a', { tasks: marks('1.1:x') })] }])
  await restoreMirrors(io, ['a'])
  const rec = (await readPlan(io)).changes.a
  expect(rec?.verify?.findings.map(f => f.requirement)).toEqual(['Export CSV', 'Import CSV'])
  expect(rec?.verify?.passed).toBe(false)
  expect(actionsFor(rec).archive).toEqual({ enabled: false, reason: 'no passed verify run' })
  await appendPlan(io, [{ type: 'VerifyRecorded', changeId: 'a', scope: [], findings: [{ id: 'r:export-csv', requirement: 'Export CSV', verdict: 'true', evidence: ['src/export.ts:3'] }] }])
  expect((await readPlan(io)).changes.a?.verify?.passed).toBe(true)
})

test('restored findings, Q&A turns and critique items of the wrong shape are dropped', () => {
  const restored = parseMirror(JSON.stringify({
    revisions: [{ proposalId: 'p', artifact: 'design', commit: 'abc', at: 1 }, { proposalId: 7 }],
    qa: { turns: [{ question: 'Q?', options: ['A'], why: 'w', answer: 'A' }, { question: 1, options: 'A', why: 'w' }], done: true, capped: 'yes' },
    critique: [{ severity: 'high', artifact: 'design', issue: 'i', suggestion: 's' }, { severity: 'extreme', artifact: 'design', issue: 'i', suggestion: 's' }, 'x'],
    verify: { runs: 2, passed: true, findings: [
      { id: 'r:a', requirement: 'A', verdict: 'false', evidence: ['src/a.ts:1'] },
      { id: 'r:b', requirement: 5, verdict: 'true', evidence: [] },
      { id: 'r:c', requirement: 'C', verdict: 'bogus', evidence: [] },
      { id: 'r:d', requirement: 'D', verdict: 'false', evidence: 'nope' },
      { id: 'r:e', requirement: 'E', verdict: 'false', evidence: [1] },
    ] },
  }))
  expect(restored?.revisions).toEqual([{ proposalId: 'p', artifact: 'design', commit: 'abc', at: 1 }])
  expect(restored?.qa).toEqual({ turns: [{ question: 'Q?', options: ['A'], why: 'w', answer: 'A' }], done: true, capped: false })
  expect(restored?.critique).toEqual([{ severity: 'high', artifact: 'design', issue: 'i', suggestion: 's' }])
  expect(restored?.verify?.findings).toEqual([{ id: 'r:a', requirement: 'A', verdict: 'false', evidence: ['src/a.ts:1'] }])
  expect(restored?.verify?.passed).toBe(false)
})
