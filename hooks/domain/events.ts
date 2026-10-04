import type {
  Gate, ModelChoice, PendingPhase, Phase, ReviewVerdict, Role, RunOutcome, Task, TaskSource, TaskStatus,
} from './types.ts'

export interface ParsedTask {
  readonly label: string
  readonly title: string
  readonly section: string
  readonly description: string
  readonly done: boolean
  readonly blockedText?: string
  readonly dependsOn: readonly string[]
  readonly line: string
}

export interface TaskPatch {
  readonly title?: string
  readonly description?: string
  readonly priority?: number
  /** '' clears the wait reason. */
  readonly waitReason?: string
  readonly assignee?: string
  readonly dependsOn?: readonly string[]
  /** null clears the pending phase. */
  readonly pending?: PendingPhase | null
  /** Merged per role into the task's overrides. */
  readonly overrides?: Readonly<Partial<Record<Role, ModelChoice>>>
}

export type EventBody =
  | { readonly type: 'ChangeLoaded'; readonly tasks: readonly ParsedTask[] }
  | {
      readonly type: 'TaskCreated'
      readonly task: {
        readonly id: string
        readonly title: string
        readonly source: TaskSource
        readonly section?: string
        readonly description?: string
        readonly dependsOn?: readonly string[]
        readonly status?: TaskStatus
      }
    }
  | { readonly type: 'TaskUpdated'; readonly taskId: string; readonly patch: TaskPatch }
  | { readonly type: 'TaskRemoved'; readonly taskId: string }
  | { readonly type: 'TaskRestored'; readonly task: Task }
  | {
      readonly type: 'TaskStatusChanged'
      readonly taskId: string
      readonly from: TaskStatus
      readonly to: TaskStatus
      readonly reason?: string
    }
  | {
      readonly type: 'PhaseStarted'
      readonly taskId: string
      readonly phase: Phase
      readonly attempt: number
      readonly agentId: string
      readonly agentType: string
      readonly role: Role
      readonly model: string
      readonly effort?: string
      readonly baseline: Readonly<Record<string, string>>
    }
  | { readonly type: 'AgentActivity'; readonly agentId: string; readonly tool?: string; readonly tokens?: number }
  | {
      readonly type: 'AgentStopped'
      readonly agentId: string
      readonly outcome?: RunOutcome
      readonly transcriptPath?: string
      readonly effort?: string
    }
  | {
      readonly type: 'PhaseCompleted'
      readonly taskId: string
      readonly phase: Phase
      readonly attempt: number
      readonly gate: Gate
      readonly reason?: string
      readonly summary?: string
      readonly artifactKey?: string
      readonly allowedFiles?: readonly string[]
      readonly testFiles?: readonly string[]
      readonly touched?: readonly string[]
    }
  | { readonly type: 'ReviewVerdictRecorded'; readonly taskId: string; readonly verdict: ReviewVerdict }
  | { readonly type: 'GuardDenied'; readonly taskId: string; readonly agentId: string; readonly path: string }
  | {
      readonly type: 'CommentAdded'
      readonly taskId: string
      readonly comment: { readonly id: string; readonly author: string; readonly text: string }
    }
  | { readonly type: 'CommentDelivered'; readonly taskId: string; readonly commentId: string; readonly to: string }
  | { readonly type: 'RunControl'; readonly running: boolean; readonly paused: boolean; readonly scope?: string }
  | { readonly type: 'MirrorState'; readonly pending: boolean }
  | { readonly type: 'ConfigWarnings'; readonly warnings: readonly string[] }
  | { readonly type: 'ModError'; readonly hook: string; readonly taskId?: string; readonly message: string }

export type DomainEvent = EventBody & { readonly seq: number; readonly at: number; readonly changeId: string }
export type EventOf<T extends EventBody['type']> = Extract<DomainEvent, { readonly type: T }>
