export type TaskStatus = 'backlog' | 'ready' | 'running' | 'review' | 'needs_decision' | 'blocked' | 'done'
export const TASK_STATUSES: readonly TaskStatus[] = ['backlog', 'ready', 'running', 'review', 'needs_decision', 'blocked', 'done']

export type Phase = 'research' | 'plan' | 'tdd' | 'code' | 'review' | 'refactor'
export const PHASES: readonly Phase[] = ['research', 'plan', 'tdd', 'code', 'review', 'refactor']

export type Gate = 'pass' | 'fail'
export type RunOutcome = 'ok' | 'gate_failed' | 'denied' | 'error' | 'interrupted'
export type TaskSource = 'openspec' | 'native' | 'board'

export type Role = 'researcher' | 'planner' | 'tdd' | 'implementer' | 'reviewer' | 'refactorer'
export const ROLES: readonly Role[] = ['researcher', 'planner', 'tdd', 'implementer', 'reviewer', 'refactorer']
export const ROLE_OF: Readonly<Record<Phase, Role>> = {
  research: 'researcher',
  plan: 'planner',
  tdd: 'tdd',
  code: 'implementer',
  review: 'reviewer',
  refactor: 'refactorer',
}

export const READ_ONLY_PHASES: readonly Phase[] = ['research', 'plan', 'review']
export const WRITE_PHASES: readonly Phase[] = ['code', 'refactor']
export const LOOP_CAP = 3
export const AGENT_PREFIX = 'zboard'
export const agentTypeOf = (role: Role): string => `${AGENT_PREFIX}:${role}`

export interface AgentRun {
  readonly agentId: string
  readonly agentType: string
  readonly role: Role
  readonly phase: Phase
  readonly attempt: number
  readonly taskId: string
  readonly model: string
  readonly effort?: string
  readonly startedAt: number
  readonly endedAt?: number
  readonly lastActivityAt: number
  readonly currentTool?: string
  readonly tokens: number
  readonly outcome?: RunOutcome
  readonly transcriptPath?: string
  readonly denies: number
  readonly baseline: Readonly<Record<string, string>>
}

export interface Comment {
  readonly id: string
  readonly author: string
  readonly text: string
  readonly at: number
  readonly deliveredTo?: string
}

export interface PhaseRecord {
  readonly phase: Phase
  readonly attempt: number
  readonly loop: number
  readonly gate: Gate
  readonly reason?: string
  readonly summary?: string
  readonly artifactKey?: string
  readonly at: number
}

export interface Finding {
  readonly severity: 'high' | 'medium' | 'low'
  readonly file: string
  readonly line?: number
  readonly issue: string
}

export interface ReviewVerdict {
  readonly verdict: 'approve' | 'changes'
  readonly findings: readonly Finding[]
}

export interface ModelChoice {
  readonly model?: string
  readonly effort?: string
}

export interface PendingPhase {
  readonly phase: Phase
  readonly attempt: number
  readonly reason?: string
  readonly partial?: string
}

export interface Task {
  readonly id: string
  readonly changeId: string
  readonly title: string
  readonly section: string
  readonly description: string
  readonly line?: string
  readonly blockedText?: string
  readonly dependsOn: readonly string[]
  readonly status: TaskStatus
  readonly statusReason?: string
  readonly waitReason?: string
  readonly phase: Phase | null
  readonly pending?: PendingPhase
  readonly loop: number
  readonly priority: number
  readonly allowedFiles: readonly string[]
  readonly testFiles: readonly string[]
  readonly touched: readonly string[]
  readonly agents: readonly AgentRun[]
  readonly comments: readonly Comment[]
  readonly phases: readonly PhaseRecord[]
  readonly source: TaskSource
  readonly assignee?: string
  readonly overrides: Readonly<Partial<Record<Role, ModelChoice>>>
  readonly verdict?: ReviewVerdict
}

export interface ModErrorRecord {
  readonly hook: string
  readonly taskId?: string
  readonly message: string
  readonly at: number
}

export interface Board {
  readonly changeId: string | null
  readonly tasks: Readonly<Record<string, Task>>
  readonly order: readonly string[]
  readonly running: boolean
  readonly paused: boolean
  readonly scope?: string
  readonly mirrorPending: boolean
  readonly configWarnings: readonly string[]
  readonly errors: readonly ModErrorRecord[]
}

export const emptyBoard = (changeId: string | null): Board => ({
  changeId,
  tasks: {},
  order: [],
  running: false,
  paused: false,
  mirrorPending: false,
  configWarnings: [],
  errors: [],
})

export interface NewTaskInput {
  readonly id: string
  readonly changeId: string
  readonly title: string
  readonly source: TaskSource
  readonly section?: string
  readonly description?: string
  readonly dependsOn?: readonly string[]
  readonly status?: TaskStatus
  readonly line?: string
  readonly blockedText?: string
}

export const newTask = (input: NewTaskInput): Task => ({
  id: input.id,
  changeId: input.changeId,
  title: input.title,
  section: input.section ?? '',
  description: input.description ?? input.title,
  line: input.line,
  blockedText: input.blockedText,
  dependsOn: input.dependsOn ?? [],
  status: input.status ?? 'ready',
  phase: null,
  loop: 0,
  priority: 0,
  allowedFiles: [],
  testFiles: [],
  touched: [],
  agents: [],
  comments: [],
  phases: [],
  source: input.source,
  overrides: {},
})
