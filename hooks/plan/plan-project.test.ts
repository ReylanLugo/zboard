import { expect, test } from 'claude-code/testing'

import { deepFreeze } from '../testing/factories.ts'
import { OK_READINESS, agent, cliStatus, finding, listing, marks } from '../testing/plan.ts'
import type { PlanEvent, PlanEventBody } from './plan-events.ts'
import { EMPTY_PLAN_LOG, appendPlanEvents, planOf } from './plan-log.ts'
import { changeOfAgent, projectPlan } from './plan-project.ts'
import type { DiffProposal } from './types.ts'

const evs = (bodies: readonly PlanEventBody[]): PlanEvent[] => bodies.map((body, index) => ({ ...body, seq: index + 1, at: 1_000 + index }))
const proposal = (id: string): DiffProposal => ({
  id, artifact: 'design', reason: 'r', status: 'pending', source: { kind: 'draft', artifact: 'design' },
  files: [{ path: 'openspec/changes/a/design.md', before: 'old\n', after: 'new\n' }],
})

test('a full listing groups changes and derives their stages', () => {
  const board = projectPlan(evs([{
    type: 'ChangesListed', complete: true, changes: [
      listing('a', { status: cliStatus(['brainstorm', 'proposal', 'design', 'specs', 'tasks', 'plan']), readiness: OK_READINESS, tasks: marks('1.1') }),
      listing('b', { status: cliStatus(['brainstorm']) }),
      listing('c', { archived: true }),
    ],
  }]))
  expect(board.order).toEqual(['a', 'b', 'c'])
  expect(['a', 'b', 'c'].map(id => board.changes[id]?.stage)).toEqual(['ready', 'authoring', 'archived'])
})

test('a CLI failure is kept as the list error and invents no change', () => {
  const board = projectPlan(evs([{ type: 'ChangesListed', complete: true, changes: [], error: 'openspec: command not found' }]))
  expect(board).toMatchObject({ listError: 'openspec: command not found', order: [] })
})

test('a second proposal for the same change is refused as a PlanError', () => {
  const board = projectPlan(evs([
    { type: 'ProposalReady', changeId: 'a', proposal: proposal('p1') },
    { type: 'ProposalReady', changeId: 'a', proposal: proposal('p2') },
  ]))
  expect(board.changes.a?.proposal?.id).toBe('p1')
  expect(board.changes.a?.errors.map(e => e.message)).toEqual(['a proposal is already pending for a'])
})

test('a second agent for the same change is refused; a stop clears the slot', () => {
  const board = projectPlan(evs([
    { type: 'PlanAgentStarted', changeId: 'a', agent: agent('agent-1') },
    { type: 'PlanAgentStarted', changeId: 'a', agent: agent('agent-2') },
  ]))
  expect(board.changes.a?.activeAgent?.agentId).toBe('agent-1')
  expect(board.changes.a?.errors.map(e => e.message)).toEqual(['an agent is already running for a'])
  expect(changeOfAgent(board, 'agent-1')?.id).toBe('a')
  const stopped = projectPlan(evs([{ type: 'PlanAgentStopped', changeId: 'a', agentId: 'agent-1', outcome: 'interrupted' }]), board)
  expect(stopped.changes.a).toMatchObject({ retryable: { agentId: 'agent-1' } })
  expect(stopped.changes.a?.activeAgent).toBeUndefined()
})

test('a failed first attempt is not retryable; a failed second attempt is', () => {
  const first = projectPlan(evs([
    { type: 'PlanAgentStarted', changeId: 'a', agent: agent('agent-1') },
    { type: 'PlanAgentStopped', changeId: 'a', agentId: 'agent-1', outcome: 'failed' },
  ]))
  expect(first.changes.a?.retryable).toBeUndefined()
  const second = projectPlan(evs([
    { type: 'PlanAgentStarted', changeId: 'a', agent: agent('agent-2', { kind: 'explain' }, 'explainer', 2) },
    { type: 'PlanAgentStopped', changeId: 'a', agentId: 'agent-2', outcome: 'failed' },
  ]), first)
  expect(second.changes.a?.retryable?.agentId).toBe('agent-2')
})

test('Q&A turns accumulate, answers fill the open turn, finish marks the cap', () => {
  const board = projectPlan(evs([
    { type: 'QaAsked', changeId: 'a', question: 'Who?', options: ['A', 'B'], why: 'scope' },
    { type: 'QaAnswered', changeId: 'a', answer: 'B' },
    { type: 'QaAsked', changeId: 'a', question: 'When?', options: [], why: 'time' },
    { type: 'QaFinished', changeId: 'a', capped: true },
  ]))
  expect(board.changes.a?.qa).toEqual({
    turns: [{ question: 'Who?', options: ['A', 'B'], why: 'scope', answer: 'B' }, { question: 'When?', options: [], why: 'time' }],
    done: true, capped: true,
  })
})

test('acceptance records the revision, links the finding and advances the plan group', () => {
  const board = projectPlan(evs([
    { type: 'VerifyRecorded', changeId: 'a', scope: [], findings: [finding({ requirement: 'R', verdict: 'false' })] },
    { type: 'DraftRequested', changeId: 'a', artifact: 'plan', groups: ['1. Core', '2. UI'] },
    { type: 'ProposalReady', changeId: 'a', proposal: { ...proposal('p1'), source: { kind: 'draft', artifact: 'plan', group: '1. Core' } } },
    { type: 'ProposalAccepted', changeId: 'a', proposalId: 'p1', revision: { proposalId: 'p1', artifact: 'plan', commit: 'abc', at: 5 }, linked: { findingId: 'r:R', task: '2.1' } },
  ]))
  expect(board.changes.a?.proposal).toBeUndefined()
  expect(board.changes.a?.revisions).toEqual([{ proposalId: 'p1', artifact: 'plan', commit: 'abc', at: 5 }])
  expect(board.changes.a?.planGroups).toEqual({ groups: ['1. Core', '2. UI'], next: 1 })
  expect(board.changes.a?.verify?.findings[0]?.linkedTask).toBe('2.1')
})

test('a scoped verify run replaces only the affected requirements', () => {
  const board = projectPlan(evs([
    { type: 'VerifyRecorded', changeId: 'a', scope: [], findings: [finding({ requirement: 'A', verdict: 'false' }), finding({ requirement: 'B' })] },
    { type: 'VerifyRecorded', changeId: 'a', scope: ['A'], findings: [finding({ requirement: 'A' })] },
  ]))
  expect(board.changes.a?.verify?.runs).toBe(2)
  expect(board.changes.a?.verify?.findings.map(f => [f.requirement, f.verdict])).toEqual([['B', 'true'], ['A', 'true']])
})

test('an archive error returns the change from archiving', () => {
  const board = projectPlan(evs([
    { type: 'ArchiveStarted', changeId: 'a' },
    { type: 'PlanError', changeId: 'a', hook: 'archive', message: 'delta conflict' },
  ]))
  expect(board.changes.a?.archiving).toBe(false)
  expect(board.changes.a?.errors.at(-1)?.message).toBe('delta conflict')
})

test('a stale event marks only the matching pending proposal', () => {
  const board = projectPlan(evs([
    { type: 'ProposalReady', changeId: 'a', proposal: proposal('p1') },
    { type: 'ProposalStale', changeId: 'a', proposalId: 'other' },
    { type: 'ProposalStale', changeId: 'a', proposalId: 'p1' },
  ]))
  expect(board.changes.a?.proposal?.status).toBe('stale')
})

function generator(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
    return state / 2_147_483_648
  }
}

function generate(count: number): PlanEventBody[] {
  const random = generator(7)
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T
  const ids = ['a', 'b', 'c']
  return Array.from({ length: count }, (_, index): PlanEventBody => {
    const changeId = pick(ids)
    return pick<PlanEventBody>([
      { type: 'ChangesListed', complete: random() < 0.3, changes: [listing(changeId, { status: cliStatus(['brainstorm']), tasks: marks('1.1') })] },
      { type: 'QaAsked', changeId, question: `q${index}`, options: ['x'], why: 'w' },
      { type: 'QaAnswered', changeId, answer: `a${index}` },
      { type: 'ProposalReady', changeId, proposal: proposal(`p${index}`) },
      { type: 'ProposalRejected', changeId, proposalId: `p${index - 1}` },
      { type: 'PlanAgentStarted', changeId, agent: agent(`agent-${index}`) },
      { type: 'PlanAgentStopped', changeId, agentId: `agent-${index - 1}`, outcome: 'ok' },
      { type: 'PlanError', changeId, hook: 'h', message: `m${index}` },
      { type: 'RunStarted', changeId },
    ])
  })
}

test('snapshot plus tail projects the same board as the whole log', () => {
  const bodies = generate(700)
  const compacted = bodies.reduce((log, body, index) => appendPlanEvents(log, [body], 1_000 + index, 50).log, EMPTY_PLAN_LOG)
  const whole = bodies.reduce((log, body, index) => appendPlanEvents(log, [body], 1_000 + index, 10_000).log, EMPTY_PLAN_LOG)
  expect(compacted.snapshot).not.toBeNull()
  expect(planOf(compacted)).toEqual(planOf(whole))
  expect(compacted.seq).toBe(700)
})

test('folding never mutates the events or the previous board', () => {
  const events = deepFreeze(evs(generate(200)))
  const before = deepFreeze(projectPlan(events.slice(0, 100)))
  expect(() => projectPlan(events.slice(100), before)).not.toThrow()
})
