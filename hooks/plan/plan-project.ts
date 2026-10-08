import { stageOf, verifyPassed } from './lifecycle.ts'
import type { PlanEvent } from './plan-events.ts'
import type { ChangeListing, ChangeRecord, PlanBoard, PlanErrorRecord, QaSession } from './types.ts'
import { PLAN_MAX_ATTEMPTS, emptyPlanBoard, emptyRecord } from './types.ts'

export const PLAN_ERROR_CAP = 20

type Patch = (rec: ChangeRecord) => ChangeRecord
type Of<T extends PlanEvent['type']> = Extract<PlanEvent, { type: T }>

const capped = (errors: readonly PlanErrorRecord[]): readonly PlanErrorRecord[] => errors.slice(-PLAN_ERROR_CAP)

/** Applies a patch, then re-derives the stage and the verify pass flag (D2, D13.6). */
function withRecord(board: PlanBoard, id: string, patch: Patch): PlanBoard {
  const changed = patch(board.changes[id] ?? emptyRecord(id))
  const verify = changed.verify === undefined ? {} : { verify: { ...changed.verify, passed: verifyPassed(changed.verify.findings, changed.tasks) } }
  const settled: ChangeRecord = { ...changed, ...verify, stage: stageOf(changed) }
  return {
    ...board,
    changes: { ...board.changes, [id]: settled },
    order: board.order.includes(id) ? board.order : [...board.order, id],
  }
}

const refuse = (rec: ChangeRecord, at: number, hook: string, message: string): ChangeRecord =>
  ({ ...rec, errors: capped([...rec.errors, { changeId: rec.id, hook, message, at }]) })

const fromListing = (l: ChangeListing): Patch => rec => ({
  ...rec,
  archived: l.archived,
  listed: true,
  fingerprint: l.fingerprint,
  tasks: l.tasks,
  readiness: l.readiness,
  listError: l.error,
  ...(l.status === undefined ? {} : { status: l.status }),
})

function listed(board: PlanBoard, e: Of<'ChangesListed'>): PlanBoard {
  const reset: PlanBoard = e.complete
    ? { ...board, listError: e.error, changes: Object.fromEntries(Object.entries(board.changes).map(([id, rec]) => [id, { ...rec, listed: false }])) }
    : board
  const merged = e.changes.reduce((acc, l) => withRecord(acc, l.id, fromListing(l)), reset)
  if (!e.complete) return merged
  const ids = e.changes.map(l => l.id)
  return { ...merged, order: [...ids, ...merged.order.filter(id => !ids.includes(id))] }
}

function answered(rec: ChangeRecord, answer: string): ChangeRecord {
  const turns = rec.qa?.turns ?? []
  const last = turns.at(-1)
  if (last === undefined || last.answer !== undefined) return rec
  const qa: QaSession = { turns: [...turns.slice(0, -1), { ...last, answer }], done: false, capped: false }
  return { ...rec, qa }
}

function accepted(rec: ChangeRecord, e: Of<'ProposalAccepted'>): ChangeRecord {
  const proposal = rec.proposal
  if (proposal?.id !== e.proposalId) return rec
  const groups = rec.planGroups !== undefined && proposal.source.group !== undefined
    ? { ...rec.planGroups, next: rec.planGroups.next + 1 }
    : rec.planGroups
  const link = e.linked
  const verify = link === undefined || rec.verify === undefined
    ? rec.verify
    : { ...rec.verify, findings: rec.verify.findings.map(f => (f.id === link.findingId ? { ...f, linkedTask: link.task } : f)) }
  return { ...rec, proposal: undefined, revisions: [...rec.revisions, e.revision], planGroups: groups, verify }
}

/** A role's agent that started or finished well makes that role's earlier spawn and agent errors stale. */
const withoutRoleErrors = (rec: ChangeRecord, role: string): ChangeRecord => {
  const stale = new Set([`spawn.${role}`, `agent.${role}`])
  return { ...rec, errors: rec.errors.filter(error => !stale.has(error.hook)) }
}

function stopped(rec: ChangeRecord, e: Of<'PlanAgentStopped'>): ChangeRecord {
  const active = rec.activeAgent
  if (active?.agentId !== e.agentId) return rec
  const isRetryable = e.outcome === 'interrupted' || (e.outcome === 'failed' && active.attempt >= PLAN_MAX_ATTEMPTS)
  const settled: ChangeRecord = { ...rec, activeAgent: undefined, retryable: isRetryable ? active : undefined }
  return e.outcome === 'ok' ? withoutRoleErrors(settled, active.role) : settled
}

const started = (rec: ChangeRecord, e: Of<'PlanAgentStarted'>): ChangeRecord =>
  rec.activeAgent === undefined
    ? withoutRoleErrors({ ...rec, activeAgent: e.agent, retryable: undefined }, e.agent.role)
    : refuse(rec, e.at, 'agent', `an agent is already running for ${e.changeId}`)

function verified(rec: ChangeRecord, e: Of<'VerifyRecorded'>): ChangeRecord {
  const scope = new Set(e.scope)
  const kept = e.scope.length === 0 ? [] : (rec.verify?.findings ?? []).filter(f => !scope.has(f.requirement))
  return { ...rec, verify: { runs: (rec.verify?.runs ?? 0) + 1, findings: [...kept, ...e.findings], passed: false } }
}

function restored(rec: ChangeRecord, e: Of<'PlanRestored'>): ChangeRecord {
  return {
    ...rec,
    qa: rec.qa ?? e.qa,
    revisions: rec.revisions.length > 0 ? rec.revisions : e.revisions,
    critique: rec.critique ?? e.critique,
    verify: rec.verify ?? e.verify,
  }
}

function errored(board: PlanBoard, e: Of<'PlanError'>): PlanBoard {
  const record: PlanErrorRecord = { hook: e.hook, message: e.message, at: e.at, ...(e.changeId === undefined ? {} : { changeId: e.changeId }) }
  if (e.changeId === undefined) return { ...board, errors: capped([...board.errors, record]) }
  return withRecord(board, e.changeId, rec => ({ ...rec, errors: capped([...rec.errors, record]), archiving: e.hook === 'archive' ? false : rec.archiving }))
}

export function applyPlanEvent(board: PlanBoard, e: PlanEvent): PlanBoard {
  switch (e.type) {
    case 'ChangesListed':
      return listed(board, e)
    case 'ChangeCreated':
      return withRecord(board, e.changeId, rec => ({ ...rec, created: true }))
    case 'QaAsked':
      return withRecord(board, e.changeId, rec => ({
        ...rec, qa: { turns: [...(rec.qa?.turns ?? []), { question: e.question, options: e.options, why: e.why }], done: false, capped: false },
      }))
    case 'QaAnswered':
      return withRecord(board, e.changeId, rec => answered(rec, e.answer))
    case 'QaFinished':
      return withRecord(board, e.changeId, rec => ({ ...rec, qa: { turns: rec.qa?.turns ?? [], done: true, capped: e.capped } }))
    case 'DraftRequested':
      return withRecord(board, e.changeId, rec => (e.groups.length === 0 ? rec : { ...rec, planGroups: { groups: e.groups, next: 0 } }))
    case 'ProposalReady':
      return withRecord(board, e.changeId, rec =>
        rec.proposal === undefined ? { ...rec, proposal: e.proposal } : refuse(rec, e.at, 'proposal', `a proposal is already pending for ${e.changeId}`))
    case 'ProposalStale':
      return withRecord(board, e.changeId, rec =>
        rec.proposal?.id === e.proposalId ? { ...rec, proposal: { ...rec.proposal, status: 'stale' } } : rec)
    case 'ProposalAccepted':
      return withRecord(board, e.changeId, rec => accepted(rec, e))
    case 'ProposalRejected':
      return withRecord(board, e.changeId, rec => (rec.proposal?.id === e.proposalId ? { ...rec, proposal: undefined } : rec))
    case 'ExplanationCached':
      return withRecord(board, e.changeId, rec => ({ ...rec, explanation: { fingerprint: e.fingerprint, value: e.explanation } }))
    case 'CritiqueRecorded':
      return withRecord(board, e.changeId, rec => ({ ...rec, critique: e.findings }))
    case 'RunStarted':
      return withRecord(board, e.changeId, rec => ({ ...rec, runStarted: true }))
    case 'ExecutionFinished':
      return withRecord(board, e.changeId, rec => ({ ...rec, executionFinished: true }))
    case 'VerifyRecorded':
      return withRecord(board, e.changeId, rec => verified(rec, e))
    case 'FindingResolved':
      return withRecord(board, e.changeId, rec => (rec.verify === undefined ? rec : {
        ...rec, verify: { ...rec.verify, findings: rec.verify.findings.map(f => (f.id === e.findingId ? { ...f, resolution: e.resolution } : f)) },
      }))
    case 'RetrospectiveAccepted':
      return withRecord(board, e.changeId, rec => ({ ...rec, retrospectiveAccepted: true }))
    case 'ArchiveStarted':
      return withRecord(board, e.changeId, rec => ({ ...rec, archiving: true }))
    case 'ChangeArchived':
      return withRecord(board, e.changeId, rec => ({ ...rec, archiving: false, archived: true }))
    case 'PlanAgentStarted':
      return withRecord(board, e.changeId, rec => started(rec, e))
    case 'PlanAgentStopped':
      return withRecord(board, e.changeId, rec => stopped(rec, e))
    case 'PlanError':
      return errored(board, e)
    case 'PlanRestored':
      return withRecord(board, e.changeId, rec => restored(rec, e))
    case 'PlanMirrorState':
      return { ...board, mirrorPending: e.pending }
  }
}

export const projectPlan = (events: readonly PlanEvent[], from: PlanBoard = emptyPlanBoard): PlanBoard => events.reduce(applyPlanEvent, from)

export const changeOfAgent = (board: PlanBoard, agentId: string): ChangeRecord | undefined =>
  Object.values(board.changes).find(rec => rec.activeAgent?.agentId === agentId)
