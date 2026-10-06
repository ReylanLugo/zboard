import type {
  ActiveAgent, ChangeListing, CritiqueFinding, DiffProposal, Explanation, Finding, QaSession, Resolution, Revision, VerifyRun,
} from './types.ts'

/** The plan log's closed event union (design D4, plus ProposalStale, ArchiveStarted, PlanRestored and PlanMirrorState). */
export type PlanEventBody =
  | { readonly type: 'ChangesListed'; readonly changes: readonly ChangeListing[]; readonly complete: boolean; readonly error?: string }
  | { readonly type: 'ChangeCreated'; readonly changeId: string }
  | { readonly type: 'QaAsked'; readonly changeId: string; readonly question: string; readonly options: readonly string[]; readonly why: string }
  | { readonly type: 'QaAnswered'; readonly changeId: string; readonly answer: string }
  | { readonly type: 'QaFinished'; readonly changeId: string; readonly capped: boolean }
  | { readonly type: 'DraftRequested'; readonly changeId: string; readonly artifact: string; readonly groups: readonly string[] }
  | { readonly type: 'ProposalReady'; readonly changeId: string; readonly proposal: DiffProposal }
  | { readonly type: 'ProposalStale'; readonly changeId: string; readonly proposalId: string }
  | {
    readonly type: 'ProposalAccepted'; readonly changeId: string; readonly proposalId: string; readonly revision: Revision
    readonly linked?: { readonly findingId: string; readonly task: string }
  }
  | { readonly type: 'ProposalRejected'; readonly changeId: string; readonly proposalId: string }
  | { readonly type: 'ExplanationCached'; readonly changeId: string; readonly fingerprint: string; readonly explanation: Explanation }
  | { readonly type: 'CritiqueRecorded'; readonly changeId: string; readonly findings: readonly CritiqueFinding[] }
  | { readonly type: 'RunStarted'; readonly changeId: string }
  | { readonly type: 'ExecutionFinished'; readonly changeId: string }
  | { readonly type: 'VerifyRecorded'; readonly changeId: string; readonly findings: readonly Finding[]; readonly scope: readonly string[] }
  | { readonly type: 'FindingResolved'; readonly changeId: string; readonly findingId: string; readonly resolution: Resolution }
  | { readonly type: 'RetrospectiveAccepted'; readonly changeId: string }
  | { readonly type: 'ArchiveStarted'; readonly changeId: string }
  | { readonly type: 'ChangeArchived'; readonly changeId: string }
  | { readonly type: 'PlanAgentStarted'; readonly changeId: string; readonly agent: ActiveAgent }
  | { readonly type: 'PlanAgentStopped'; readonly changeId: string; readonly agentId: string; readonly outcome: 'ok' | 'failed' | 'interrupted' }
  | { readonly type: 'PlanError'; readonly changeId?: string; readonly hook: string; readonly message: string }
  | {
    readonly type: 'PlanRestored'; readonly changeId: string; readonly qa?: QaSession; readonly revisions: readonly Revision[]
    readonly critique?: readonly CritiqueFinding[]; readonly verify?: VerifyRun
  }
  | { readonly type: 'PlanMirrorState'; readonly pending: boolean }

export type PlanEvent = PlanEventBody & { readonly seq: number; readonly at: number }
