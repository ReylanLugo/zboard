import { expect, test } from 'claude-code/testing'

import { OK_READINESS, agent, cliStatus, finding, marks, record } from '../testing/plan.ts'
import { actionsFor, affectedRequirements, groupOf, nextArtifact, stageOf, verifyPassed } from './lifecycle.ts'

const PLANNED = ['brainstorm', 'proposal', 'design', 'specs', 'tasks', 'plan']

test('stages follow the lifecycle from draft to archived', () => {
  expect(stageOf(record({ created: true }))).toBe('draft')
  expect(stageOf(record({ status: cliStatus(['brainstorm']) }))).toBe('authoring')
  expect(stageOf(record({ status: cliStatus(PLANNED), readiness: OK_READINESS, tasks: marks('1.1') }))).toBe('ready')
  expect(stageOf(record({ status: cliStatus(PLANNED), readiness: OK_READINESS, tasks: marks('1.1'), runStarted: true }))).toBe('executing')
  expect(stageOf(record({ status: cliStatus(PLANNED), tasks: marks('1.1:x') }))).toBe('verifying')
  const passed = { runs: 1, findings: [finding({ requirement: 'R' })], passed: true }
  expect(stageOf(record({ tasks: marks('1.1:x'), verify: passed }))).toBe('retrospective')
  expect(stageOf(record({ archiving: true }))).toBe('archiving')
  expect(stageOf(record({ archived: true }))).toBe('archived')
})

test('a failing readiness check or pending plan groups keep a change in authoring', () => {
  const failing = OK_READINESS.map(check => (check.id === 'coverage' ? { ...check, ok: false, detail: '2.3 names no requirement' } : check))
  expect(stageOf(record({ status: cliStatus(PLANNED), readiness: failing, tasks: marks('1.1') }))).toBe('authoring')
  const groups = { groups: ['1. Core', '2. UI'], next: 1 }
  expect(stageOf(record({ status: cliStatus(PLANNED), readiness: OK_READINESS, tasks: marks('1.1'), planGroups: groups }))).toBe('authoring')
})

test('a fix_code task opened after verify returns the change to executing', () => {
  const verify = { runs: 1, findings: [finding({ requirement: 'R', verdict: 'false', resolution: 'fix_code', linkedTask: '1.2' })], passed: false }
  expect(stageOf(record({ tasks: marks('1.1:x', '1.2'), verify }))).toBe('executing')
})

test('grouping: apply-required done is Active, brainstorm only is Drafts, archived is Archived', () => {
  expect(groupOf(record({ status: cliStatus(PLANNED) }))).toBe('active')
  expect(groupOf(record({ status: cliStatus(['brainstorm']) }))).toBe('drafts')
  expect(groupOf(record({ archived: true }))).toBe('archived')
})

test('another schema drives the next artifact by CLI order', () => {
  const other = cliStatus(['proposal'], ['tasks'], [['proposal', 'proposal.md', []], ['specs', 'specs/**/*.md', ['proposal']], ['tasks', 'tasks.md', ['specs']]])
  expect(nextArtifact(record({ status: other }))?.id).toBe('specs')
})

test('verify and retrospective artifacts are never drafted by draft next', () => {
  const rec = record({ status: cliStatus(PLANNED) })
  expect(nextArtifact(rec)).toBeUndefined()
  expect(actionsFor(rec).draft).toEqual({ enabled: false, reason: 'every planning artifact is done' })
})

test('draft next names the missing dependency when everything left is blocked', () => {
  const status = {
    schema: 'other', applyRequires: ['tasks'], artifacts: [
      { id: 'proposal', path: 'proposal.md', requires: [], status: 'done' as const },
      { id: 'specs', path: 'specs/**/*.md', requires: ['proposal', 'research'], status: 'blocked' as const },
      { id: 'tasks', path: 'tasks.md', requires: ['specs'], status: 'blocked' as const },
    ],
  }
  expect(actionsFor(record({ status })).draft).toEqual({ enabled: false, reason: 'blocked: specs needs research' })
})

test('one active agent disables every agent action', () => {
  const gates = actionsFor(record({ status: cliStatus(['brainstorm']), activeAgent: agent('agent-1') }))
  expect(gates.draft).toEqual({ enabled: false, reason: 'an agent is already running for a' })
  expect(gates.explain.enabled).toBe(false)
})

test('run is gated by readiness and names the failing checks', () => {
  const failing = OK_READINESS.map(check => (check.id === 'cycles' ? { ...check, ok: false } : check))
  expect(actionsFor(record({ status: cliStatus(PLANNED), readiness: failing, tasks: marks('1.1') })).run).toEqual({ enabled: false, reason: 'readiness: cycles' })
  expect(actionsFor(record({ status: cliStatus(PLANNED), readiness: OK_READINESS, tasks: marks('1.1') })).run.enabled).toBe(true)
})

test('verify is offered only when every task is checked', () => {
  expect(actionsFor(record({ tasks: marks('1.1:x', '1.2') })).verify).toEqual({ enabled: false, reason: '1 task(s) open: 1.2' })
  expect(actionsFor(record({ tasks: marks('1.1:x') })).verify.enabled).toBe(true)
})

test('archive needs a passed verify run, closed linked tasks and a done retrospective', () => {
  const base = { status: cliStatus([...PLANNED, 'verify', 'retrospective']), tasks: marks('1.1:x') }
  expect(actionsFor(record(base)).archive).toEqual({ enabled: false, reason: 'no passed verify run' })
  const linked = { runs: 2, findings: [finding({ requirement: 'R', verdict: 'false', resolution: 'fix_code', linkedTask: '1.2' })], passed: false }
  expect(actionsFor(record({ ...base, tasks: marks('1.1:x', '1.2'), verify: linked })).archive).toEqual({ enabled: false, reason: 'linked task 1.2 is open' })
  const passed = { runs: 1, findings: [finding({ requirement: 'R' })], passed: true }
  expect(actionsFor(record({ ...base, verify: passed })).archive.enabled).toBe(true)
  const noRetro = { ...base, status: cliStatus([...PLANNED, 'verify']), verify: passed }
  expect(actionsFor(record(noRetro)).archive).toEqual({ enabled: false, reason: 'the retrospective is not done' })
})

test('verifyPassed needs every finding true or accepted and every linked task checked', () => {
  expect(verifyPassed([finding({ requirement: 'R' }), finding({ requirement: 'S', verdict: 'no_evidence', resolution: 'accepted' })], marks('1.1:x'))).toBe(true)
  expect(verifyPassed([finding({ requirement: 'R', verdict: 'no_evidence' })], marks('1.1:x'))).toBe(false)
  expect(verifyPassed([finding({ requirement: 'R', resolution: 'accepted', linkedTask: '1.2' })], marks('1.1:x', '1.2'))).toBe(false)
  expect(verifyPassed([], marks('1.1:x'))).toBe(false)
})

test('re-judge scope is the resolved requirements whose linked tasks are done', () => {
  const findings = [
    finding({ requirement: 'A', verdict: 'false', resolution: 'fix_code', linkedTask: '2.1' }),
    finding({ requirement: 'B', verdict: 'false', resolution: 'fix_code', linkedTask: '2.2' }),
    finding({ requirement: 'C', verdict: 'ambiguous', resolution: 'adjust_spec' }),
    finding({ requirement: 'D' }),
  ]
  expect(affectedRequirements(findings, marks('2.1:x', '2.2'))).toEqual(['A', 'C'])
})
