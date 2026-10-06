import type { ArtifactState, ChangeGroup, ChangeRecord, ChangeStage, Finding, TaskMark } from './types.ts'
import { RETRO_ARTIFACT } from './types.ts'

export type ActionId =
  | 'draft' | 'comment' | 'accept' | 'reject' | 'regenerate' | 'explain' | 'critique'
  | 'run' | 'verify' | 'rejudge' | 'retrospective' | 'archive'
export const ACTION_IDS: readonly ActionId[] = [
  'draft', 'comment', 'accept', 'reject', 'regenerate', 'explain', 'critique', 'run', 'verify', 'rejudge', 'retrospective', 'archive',
]

export interface ActionGate {
  readonly enabled: boolean
  readonly reason: string
}

const on = (reason = ''): ActionGate => ({ enabled: true, reason })
const off = (reason: string): ActionGate => ({ enabled: false, reason })

const artifactOf = (rec: ChangeRecord, id: string): ArtifactState | undefined => rec.status?.artifacts.find(a => a.id === id)
export const hasArtifact = (rec: ChangeRecord, id: string): boolean => artifactOf(rec, id) !== undefined
export const isDone = (rec: ChangeRecord, id: string): boolean => artifactOf(rec, id)?.status === 'done'

const missingRequired = (rec: ChangeRecord): string[] => (rec.status?.applyRequires ?? []).filter(id => !isDone(rec, id))
export const requiredDone = (rec: ChangeRecord): boolean => (rec.status?.applyRequires ?? []).length > 0 && missingRequired(rec).length === 0
export const readinessOk = (rec: ChangeRecord): boolean => rec.readiness.length > 0 && rec.readiness.every(check => check.ok)

export const allTasksChecked = (tasks: readonly TaskMark[]): boolean => tasks.length > 0 && tasks.every(task => task.done)
export const openTasks = (tasks: readonly TaskMark[]): string[] => tasks.filter(task => !task.done).map(task => task.label)

export const openLinkedTasks = (findings: readonly Finding[], tasks: readonly TaskMark[]): string[] =>
  findings.flatMap(f => (f.linkedTask === undefined ? [] : [f.linkedTask]))
    .filter(label => tasks.find(task => task.label === label)?.done !== true)

/** D13.6: every finding true or accepted, and every finding-linked task checked. */
export const verifyPassed = (findings: readonly Finding[], tasks: readonly TaskMark[]): boolean =>
  findings.length > 0 && findings.every(f => f.verdict === 'true' || f.resolution === 'accepted') && openLinkedTasks(findings, tasks).length === 0

/** D13.5: requirements to re-judge — resolved by a spec change, or by a task that is now done. */
export function affectedRequirements(findings: readonly Finding[], tasks: readonly TaskMark[]): string[] {
  const isTaskDone = (label: string): boolean => tasks.find(task => task.label === label)?.done === true
  const affected = findings.filter(f =>
    f.resolution === 'adjust_spec' || ((f.resolution === 'fix_code' || f.resolution === 'add_test') && f.linkedTask !== undefined && isTaskDone(f.linkedTask)))
  return [...new Set(affected.map(f => f.requirement))]
}

const groupsPending = (rec: ChangeRecord): boolean => rec.planGroups !== undefined && rec.planGroups.next < rec.planGroups.groups.length

export function stageOf(rec: ChangeRecord): ChangeStage {
  if (rec.archived) return 'archived'
  if (rec.archiving) return 'archiving'
  if (rec.verify !== undefined && verifyPassed(rec.verify.findings, rec.tasks)) return 'retrospective'
  const checked = allTasksChecked(rec.tasks)
  if (rec.verify !== undefined) return checked ? 'verifying' : 'executing'
  if (checked) return 'verifying'
  if (rec.runStarted) return 'executing'
  if (requiredDone(rec) && readinessOk(rec) && !groupsPending(rec)) return 'ready'
  return (rec.status?.artifacts ?? []).some(a => a.status === 'done') ? 'authoring' : 'draft'
}

const ACTIVE_STAGES: readonly ChangeStage[] = ['executing', 'verifying', 'retrospective', 'archiving']

export function groupOf(rec: ChangeRecord): ChangeGroup {
  if (rec.archived) return 'archived'
  return requiredDone(rec) || rec.runStarted || ACTIVE_STAGES.includes(stageOf(rec)) ? 'active' : 'drafts'
}

/** Artifacts up to the last apply-required one, in CLI order; verify and retrospective have their own flows. */
export function planningArtifacts(rec: ChangeRecord): readonly ArtifactState[] {
  const artifacts = rec.status?.artifacts ?? []
  const required = rec.status?.applyRequires ?? []
  const last = Math.max(-1, ...required.map(id => artifacts.findIndex(a => a.id === id)))
  return last < 0 ? artifacts : artifacts.slice(0, last + 1)
}

export const nextArtifact = (rec: ChangeRecord): ArtifactState | undefined => planningArtifacts(rec).find(a => a.status === 'ready')

export function blockedReason(rec: ChangeRecord): string {
  const pending = planningArtifacts(rec).find(a => a.status !== 'done')
  if (pending === undefined) return 'every planning artifact is done'
  const missing = pending.requires.filter(id => !isDone(rec, id))
  return `blocked: ${pending.id} needs ${missing.join(', ') || 'nothing (refresh the change)'}`
}

function draftGate(rec: ChangeRecord): ActionGate {
  if (rec.proposal !== undefined) return off('a proposal is pending')
  const last = rec.qa?.turns.at(-1)
  if (rec.qa?.done === false && last !== undefined && last.answer === undefined) return off('answer the open question first')
  if (groupsPending(rec)) return on('draft the next plan group')
  const next = nextArtifact(rec)
  return next === undefined ? off(blockedReason(rec)) : on(`draft ${next.id}`)
}

function runGate(rec: ChangeRecord): ActionGate {
  const missing = missingRequired(rec)
  if (rec.status === undefined || missing.length > 0) return off(`apply-required artifacts not done: ${missing.join(', ') || 'unknown'}`)
  if (rec.readiness.length === 0) return off('readiness not computed yet')
  const failing = rec.readiness.filter(check => !check.ok).map(check => check.id)
  if (failing.length > 0) return off(`readiness: ${failing.join(', ')}`)
  if (groupsPending(rec)) return off('plan groups are still being drafted')
  return openTasks(rec.tasks).length === 0 ? off('no open task to run') : on()
}

function verifyGate(rec: ChangeRecord): ActionGate {
  if (rec.tasks.length === 0) return off('tasks.md has no task')
  const open = openTasks(rec.tasks)
  return open.length > 0 ? off(`${open.length} task(s) open: ${open.slice(0, 3).join(', ')}`) : on()
}

function rejudgeGate(rec: ChangeRecord): ActionGate {
  if (rec.verify === undefined) return off('no verify run yet')
  return affectedRequirements(rec.verify.findings, rec.tasks).length === 0 ? off('no resolved finding is ready for re-judge') : on()
}

function retroGate(rec: ChangeRecord): ActionGate {
  if (!hasArtifact(rec, RETRO_ARTIFACT)) return off('the schema has no retrospective artifact')
  if (rec.verify === undefined || !verifyPassed(rec.verify.findings, rec.tasks)) return off('no passed verify run')
  return isDone(rec, RETRO_ARTIFACT) ? off('the retrospective is done') : on()
}

function archiveGate(rec: ChangeRecord): ActionGate {
  if (rec.archived) return off('already archived')
  if (rec.verify === undefined) return off('no passed verify run')
  const linked = openLinkedTasks(rec.verify.findings, rec.tasks)
  if (linked.length > 0) return off(`linked task ${linked[0]} is open`)
  if (!verifyPassed(rec.verify.findings, rec.tasks)) return off('no passed verify run')
  if (hasArtifact(rec, RETRO_ARTIFACT) && !isDone(rec, RETRO_ARTIFACT)) return off('the retrospective is not done')
  return on()
}

export function actionsFor(rec: ChangeRecord | undefined): Readonly<Record<ActionId, ActionGate>> {
  if (rec === undefined) return Object.fromEntries(ACTION_IDS.map(id => [id, off('select a change first')])) as Record<ActionId, ActionGate>
  const busy = rec.activeAgent === undefined ? undefined : `an agent is already running for ${rec.id}`
  const free = (gate: ActionGate): ActionGate => (busy === undefined ? gate : off(busy))
  const proposal = rec.proposal
  const noStatus = rec.status === undefined ? off('the change has no CLI status') : on()
  return {
    draft: free(draftGate(rec)),
    comment: free(proposal === undefined ? on() : off('a proposal is pending')),
    accept: proposal === undefined ? off('no proposal is pending') : proposal.status === 'pending' ? on() : off('the proposal is stale; regenerate it'),
    reject: proposal === undefined ? off('no proposal is pending') : on(),
    regenerate: free(proposal === undefined ? off('no proposal is pending') : on()),
    explain: free(noStatus),
    critique: free(noStatus),
    run: free(runGate(rec)),
    verify: free(verifyGate(rec)),
    rejudge: free(rejudgeGate(rec)),
    retrospective: free(retroGate(rec)),
    archive: free(archiveGate(rec)),
  }
}
