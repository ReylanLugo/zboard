import type { ParsedTask } from '../domain/events.ts'
import { actionsFor, groupOf, nextArtifact } from '../plan/lifecycle.ts'
import type { SpecFile } from '../plan/readiness.ts'
import { coveringTasks, parseRequirements } from '../plan/readiness.ts'
import { isNoOpenspecRoot } from '../plan/errors.ts'
import { needsRepair } from '../plan/repair.ts'
import type { ChangeGroup, ChangeRecord, ChangeStage, PlanBoard } from '../plan/types.ts'
import { BRAINSTORM_ARTIFACT } from '../plan/types.ts'
import { progressBar } from './format.ts'

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

const GROUP_TITLE_WIDTH = Math.max(...GROUPS.map(group => group.title.length))

/** `Active   (2)`: titles padded so the counts line up. */
export const groupTitle = (plan: PlanBoard, group: (typeof GROUPS)[number]): string =>
  `${group.title.padEnd(GROUP_TITLE_WIDTH)} (${groupRows(plan, group.id).length})`

export const STAGE_ICONS: Readonly<Record<ChangeStage, string>> = {
  draft: '✎', authoring: '◐', ready: '●', executing: '▶', verifying: '◆', retrospective: '◆', archiving: '◆', archived: '✓',
}

const progressOf = (rec: ChangeRecord): string => {
  if (rec.tasks.length === 0) return ''
  const done = rec.tasks.filter(task => task.done).length
  return ` · ${progressBar(done, rec.tasks.length)} ${done}/${rec.tasks.length}`
}

/** A change row without its stage icon; the viewer draws the icon apart, in the stage color. */
export const rowText = (rec: ChangeRecord): string =>
  `${rec.id} · ${rec.stage}${progressOf(rec)}${rec.listError === undefined ? '' : ' · ⚠ error'}${rec.activeAgent === undefined ? '' : ` · ${rec.activeAgent.role} running`}`

export const rowLabel = (rec: ChangeRecord): string => `${STAGE_ICONS[rec.stage]} ${rowText(rec)}`

/** The CLI found no `openspec/` from the repository root: the viewer offers to initialize it. */
export const isNotInitialized = (plan: PlanBoard): boolean => isNoOpenspecRoot(plan.listError)

/** The list-level error worth showing; a missing OpenSpec root is a state, shown by the init card. */
export const listIssue = (plan: PlanBoard): string | undefined => (isNotInitialized(plan) ? undefined : plan.listError)

const issues = (count: number): string => `⚠ ${count} issue${count === 1 ? '' : 's'}`

const drafts = (count: number): string => `${count} draft${count === 1 ? '' : 's'}`

export function headerText(plan: PlanBoard): string {
  const visible = visibleChanges(plan)
  const count = (group: ChangeGroup): number => visible.filter(rec => groupOf(rec) === group).length
  const total = plan.errors.length + (listIssue(plan) === undefined ? 0 : 1)
  const state = isNotInitialized(plan)
    ? 'zboard changes · OpenSpec not initialized'
    : `zboard changes · ${count('active')} active · ${drafts(count('drafts'))} · ${count('archived')} archived`
  return [
    state,
    ...(plan.mirrorPending ? ['⚠ mirror pending'] : []),
    ...(total > 0 ? [issues(total)] : []),
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

export const READINESS_PENDING = 'readiness · checked once the plan is written'

/** The change's schema has a `plan` artifact that is not done yet. */
export const isPlanPending = (rec: ChangeRecord): boolean =>
  (rec.status?.artifacts ?? []).some(artifact => artifact.id === 'plan' && artifact.status !== 'done')

/** The repair button shows once the plan is written, coverage or acceptance fails, and a comment would be accepted. */
export const offersRepair = (rec: ChangeRecord): boolean =>
  !isPlanPending(rec) && needsRepair(rec.readiness) && actionsFor(rec).comment.enabled

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
