import type { ParsedTask } from '../domain/events.ts'
import { groupOf, nextArtifact } from '../plan/lifecycle.ts'
import type { SpecFile } from '../plan/readiness.ts'
import { coveringTasks, parseRequirements } from '../plan/readiness.ts'
import type { ChangeGroup, ChangeRecord, PlanBoard } from '../plan/types.ts'
import { BRAINSTORM_ARTIFACT } from '../plan/types.ts'

export const GROUPS: readonly { readonly id: ChangeGroup; readonly title: string }[] = [
  { id: 'active', title: 'Active' },
  { id: 'drafts', title: 'Drafts' },
  { id: 'archived', title: 'Archived' },
]

/** Listed (or just created) changes; an archived record that left the listing is shown through its archive directory. */
export const visibleChanges = (plan: PlanBoard): ChangeRecord[] =>
  plan.order.flatMap(id => {
    const rec = plan.changes[id]
    return rec !== undefined && (rec.listed || (rec.created && !rec.archived)) ? [rec] : []
  })

export const groupRows = (plan: PlanBoard, group: ChangeGroup): ChangeRecord[] => visibleChanges(plan).filter(rec => groupOf(rec) === group)

const progressOf = (rec: ChangeRecord): string =>
  (rec.tasks.length === 0 ? '' : ` · ${rec.tasks.filter(task => task.done).length}/${rec.tasks.length}`)

export const rowLabel = (rec: ChangeRecord): string =>
  `${rec.id} · ${rec.stage}${progressOf(rec)}${rec.listError === undefined ? '' : ' · ⚠ error'}${rec.activeAgent === undefined ? '' : ` · ${rec.activeAgent.role} running`}`

export function headerText(plan: PlanBoard): string {
  const visible = visibleChanges(plan)
  const count = (group: ChangeGroup): number => visible.filter(rec => groupOf(rec) === group).length
  const errors = plan.errors.length + (plan.listError === undefined ? 0 : 1)
  return [
    `zboard changes · ${count('active')} active · ${count('drafts')} drafts · ${count('archived')} archived`,
    ...(plan.mirrorPending ? ['⚠ mirror pending'] : []),
    ...(errors > 0 ? [`⚠ ${errors} error(s)`] : []),
  ].join(' · ')
}

export function currentArtifact(rec: ChangeRecord): string | undefined {
  const job = rec.activeAgent?.job
  if (job?.kind === 'draft') return job.artifact
  if (job?.kind === 'brainstorm') return BRAINSTORM_ARTIFACT
  return rec.proposal?.artifact ?? nextArtifact(rec)?.id
}

export type StepMark = '●' | '◐' | '○'

/** `●` done, `◐` the artifact being drafted (or next), `○` everything else. */
export function stepperMarks(rec: ChangeRecord): { readonly id: string; readonly mark: StepMark }[] {
  const current = currentArtifact(rec)
  return (rec.status?.artifacts ?? []).map(artifact => ({
    id: artifact.id,
    mark: artifact.status === 'done' ? '●' : artifact.id === current ? '◐' : '○',
  }))
}

export const stepperText = (rec: ChangeRecord): string => stepperMarks(rec).map(step => `${step.mark} ${step.id}`).join('  ')

export function readinessLine(rec: ChangeRecord): string {
  if (rec.readiness.length === 0) return 'readiness: not computed yet'
  const failing = rec.readiness.filter(check => !check.ok).map(check => check.id)
  return failing.length === 0 ? `readiness ✓ ${rec.readiness.length}/${rec.readiness.length}` : `readiness ✗ ${failing.join(', ')}`
}

/** The comment target when none is selected: the last done artifact in CLI order. */
export const defaultArtifact = (rec: ChangeRecord): string =>
  [...(rec.status?.artifacts ?? [])].reverse().find(artifact => artifact.status === 'done')?.id ?? rec.status?.artifacts[0]?.id ?? BRAINSTORM_ARTIFACT

export const historyRows = (rec: ChangeRecord): string[] =>
  rec.revisions.map(revision => `${revision.artifact} · ${revision.commit.slice(0, 7)} · ${new Date(revision.at).toISOString().slice(0, 16).replace('T', ' ')}`)

export const uncoveredRequirements = (specs: readonly SpecFile[], tasks: readonly ParsedTask[]): string[] =>
  Object.entries(coveringTasks(parseRequirements(specs), tasks)).filter(([, labels]) => labels.length === 0).map(([name]) => name)
