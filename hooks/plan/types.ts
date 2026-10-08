/** The plan layer's data model. Pure: no `$`, no adapters, no UI. */

export type ChangeStage = 'draft' | 'authoring' | 'ready' | 'executing' | 'verifying' | 'retrospective' | 'archiving' | 'archived'
export type ChangeGroup = 'active' | 'drafts' | 'archived'

export type PlanRole = 'brainstormer' | 'drafter' | 'explainer' | 'critic' | 'judge'
export const PLAN_ROLES: readonly PlanRole[] = ['brainstormer', 'drafter', 'explainer', 'critic', 'judge']
export const isPlanRole = (value: string): value is PlanRole => (PLAN_ROLES as readonly string[]).includes(value)

export const QA_CAP = 15
export const PLAN_MAX_ATTEMPTS = 2
export const CHANGE_NAME_MAX = 64

// Artifact ids the flows name. Order and completion always come from `openspec status --json`.
export const BRAINSTORM_ARTIFACT = 'brainstorm'
export const SPECS_ARTIFACT = 'specs'
export const TASKS_ARTIFACT = 'tasks'
export const PLAN_ARTIFACT = 'plan'
export const VERIFY_ARTIFACT = 'verify'
export const RETRO_ARTIFACT = 'retrospective'

export type ArtifactStatus = 'blocked' | 'ready' | 'done'

export interface ArtifactState {
  readonly id: string
  readonly status: ArtifactStatus
  /** The CLI's `outputPath`, relative to the change directory (may be a glob such as `specs/**\/*.md`). */
  readonly path: string
  readonly requires: readonly string[]
}

export interface CliStatus {
  readonly schema: string
  readonly artifacts: readonly ArtifactState[]
  readonly applyRequires: readonly string[]
}

export interface TaskMark {
  readonly label: string
  readonly done: boolean
}

export type ReadinessId = 'validate' | 'scenarios' | 'coverage' | 'cycles' | 'size' | 'acceptance'
export const READINESS_IDS: readonly ReadinessId[] = ['validate', 'scenarios', 'coverage', 'cycles', 'size', 'acceptance']

export interface ReadinessCheck {
  readonly id: ReadinessId
  readonly ok: boolean
  readonly detail: string
  /** Each failure on its own; absent on checks persisted before it existed (then `detail` is all there is). */
  readonly failures?: readonly string[]
  /** Task labels behind a coverage or acceptance failure, one per task. */
  readonly subjects?: readonly string[]
}

/** What one refresh learned about one change. */
export interface ChangeListing {
  readonly id: string
  readonly archived: boolean
  readonly status?: CliStatus
  readonly fingerprint: string
  readonly tasks: readonly TaskMark[]
  readonly readiness: readonly ReadinessCheck[]
  readonly error?: string
}

export interface QaTurn {
  readonly question: string
  readonly options: readonly string[]
  readonly why: string
  readonly answer?: string
}

export interface QaSession {
  readonly turns: readonly QaTurn[]
  readonly done: boolean
  readonly capped: boolean
}

export interface DraftJob {
  readonly kind: 'draft'
  readonly artifact: string
  /** User text (comment, ask-another note, critique finding, resolution); delivered as untrusted data. */
  readonly note?: string
  /** The rejected or reverted proposal as unified diffs. */
  readonly previous?: string
  /** `openspec validate` output after a reverted write. */
  readonly validator?: string
  /** The `##` heading of the tasks.md group the plan step drafts. */
  readonly group?: string
  /** The finding a fix_code/add_test task is linked to once accepted. */
  readonly finding?: string
}

export type PlanJob =
  | DraftJob
  | { readonly kind: 'brainstorm'; readonly finish: boolean }
  | { readonly kind: 'explain' }
  | { readonly kind: 'critique' }
  | { readonly kind: 'judge'; readonly requirements: readonly string[] }

export interface ProposalFile {
  readonly path: string
  /** null: the file must not exist when the proposal is applied. */
  readonly before: string | null
  readonly after: string
}

export interface DiffProposal {
  readonly id: string
  readonly artifact: string
  readonly reason: string
  readonly files: readonly ProposalFile[]
  readonly status: 'pending' | 'accepted' | 'rejected' | 'stale'
  /** The job that produced it; "ask another version" and corrections relaunch it. */
  readonly source: DraftJob
}

export interface Revision {
  readonly proposalId: string
  readonly artifact: string
  readonly commit: string
  readonly at: number
}

export interface CritiqueFinding {
  readonly severity: 'high' | 'medium' | 'low'
  readonly artifact: string
  readonly issue: string
  readonly suggestion: string
}

export type Verdict = 'true' | 'false' | 'no_evidence' | 'ambiguous' | 'contradiction'
export type Resolution = 'fix_code' | 'adjust_spec' | 'add_test' | 'accepted'

export interface Finding {
  readonly id: string
  readonly requirement: string
  readonly scenario?: string
  readonly verdict: Verdict
  /** `path:line` citations and `<test command>: <end line>` entries (`ptest <file>` by default). */
  readonly evidence: readonly string[]
  readonly resolution?: Resolution
  /** tasks.md label of the task added for this finding. */
  readonly linkedTask?: string
}

export interface VerifyRun {
  readonly runs: number
  readonly findings: readonly Finding[]
  readonly passed: boolean
}

export interface ActiveAgent {
  readonly agentId: string
  readonly role: PlanRole
  readonly job: PlanJob
  readonly attempt: number
  readonly startedAt: number
  readonly model: string
}

export interface PlanErrorRecord {
  readonly changeId?: string
  readonly hook: string
  readonly message: string
  readonly at: number
}

export interface Diagram {
  readonly title: string
  readonly mermaid: string
  /** SVG text rendered by mmdc (desktop). */
  readonly svg?: string
  /** Absolute path of a PNG rendered by mmdc (terminal Image). */
  readonly png?: string
}

export interface Explanation {
  readonly overview: string
  readonly sections: readonly { readonly title: string; readonly body: string }[]
  readonly diagrams: readonly Diagram[]
}

export interface Forecast {
  readonly changeId: string
  readonly groups: readonly string[]
  readonly model: string
  readonly effort?: string
  readonly estimate?: { readonly perRun: number; readonly low: number; readonly high: number }
}

export interface ChangeRecord {
  readonly id: string
  readonly stage: ChangeStage
  readonly archived: boolean
  readonly listed: boolean
  readonly status?: CliStatus
  readonly fingerprint: string
  readonly tasks: readonly TaskMark[]
  readonly readiness: readonly ReadinessCheck[]
  readonly listError?: string
  readonly created: boolean
  readonly qa?: QaSession
  /** At most one: pending or stale. Accepted and rejected proposals leave the record. */
  readonly proposal?: DiffProposal
  readonly revisions: readonly Revision[]
  readonly critique?: readonly CritiqueFinding[]
  readonly verify?: VerifyRun
  readonly explanation?: { readonly fingerprint: string; readonly value: Explanation }
  readonly activeAgent?: ActiveAgent
  /** An interrupted or twice-failed agent the user may retry. */
  readonly retryable?: ActiveAgent
  readonly planGroups?: { readonly groups: readonly string[]; readonly next: number }
  readonly runStarted: boolean
  readonly executionFinished: boolean
  readonly retrospectiveAccepted: boolean
  readonly archiving: boolean
  readonly errors: readonly PlanErrorRecord[]
}

export interface PlanBoard {
  readonly changes: Readonly<Record<string, ChangeRecord>>
  readonly order: readonly string[]
  readonly listError?: string
  readonly errors: readonly PlanErrorRecord[]
  readonly mirrorPending: boolean
}

export const emptyRecord = (id: string): ChangeRecord => ({
  id,
  stage: 'draft',
  archived: false,
  listed: false,
  fingerprint: '',
  tasks: [],
  readiness: [],
  created: false,
  revisions: [],
  runStarted: false,
  executionFinished: false,
  retrospectiveAccepted: false,
  archiving: false,
  errors: [],
})

export const emptyPlanBoard: PlanBoard = { changes: {}, order: [], errors: [], mirrorPending: false }

const CHANGE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Kebab-case only: no `/`, `\`, `..`, leading `-` or absolute path can pass. Checked before any CLI call or file access. */
export const isPlanChangeName = (id: string): boolean => id.length <= CHANGE_NAME_MAX && CHANGE_NAME.test(id)

export const changeDir = (id: string): string => `openspec/changes/${id}`
