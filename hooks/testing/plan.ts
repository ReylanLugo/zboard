import type { ActiveAgent, ChangeListing, ChangeRecord, CliStatus, Finding, PlanJob, PlanRole, ReadinessCheck, TaskMark } from '../plan/types.ts'
import { READINESS_IDS, emptyRecord } from '../plan/types.ts'

/** The superpowers-bridge schema as `openspec status --json` reports it (id, outputPath, requires). */
export const SCHEMA_ARTIFACTS: readonly (readonly [string, string, readonly string[]])[] = [
  ['brainstorm', 'brainstorm.md', []],
  ['proposal', 'proposal.md', ['brainstorm']],
  ['design', 'design.md', ['brainstorm']],
  ['specs', 'specs/**/*.md', ['proposal']],
  ['tasks', 'tasks.md', ['specs']],
  ['plan', 'plan.md', ['tasks']],
  ['verify', 'verify.md', ['plan']],
  ['retrospective', 'retrospective.md', ['verify']],
]

export function cliStatus(done: readonly string[], applyRequires: readonly string[] = ['plan'], schema = SCHEMA_ARTIFACTS): CliStatus {
  const finished = new Set(done)
  return {
    schema: 'superpowers-bridge',
    applyRequires,
    artifacts: schema.map(([id, path, requires]) => ({
      id, path, requires, status: finished.has(id) ? 'done' : requires.every(dep => finished.has(dep)) ? 'ready' : 'blocked',
    })),
  }
}

/** `marks('1.1:x', '1.2')`: 1.1 checked, 1.2 open. */
export const marks = (...labels: string[]): TaskMark[] =>
  labels.map(label => (label.endsWith(':x') ? { label: label.slice(0, -2), done: true } : { label, done: false }))

export const OK_READINESS: readonly ReadinessCheck[] = READINESS_IDS.map(id => ({ id, ok: true, detail: 'ok' }))

export const record = (patch: Partial<ChangeRecord> = {}, id = 'a'): ChangeRecord => ({ ...emptyRecord(id), ...patch })

export const finding = (patch: Partial<Finding> & { readonly requirement: string }): Finding =>
  ({ id: `r:${patch.requirement}`, verdict: 'true', evidence: ['src/a.ts:1'], ...patch })

export const listing = (id: string, patch: Partial<ChangeListing> = {}): ChangeListing =>
  ({ id, archived: false, fingerprint: `fp-${id}`, tasks: [], readiness: [], ...patch })

export const agent = (agentId: string, job: PlanJob = { kind: 'explain' }, role: PlanRole = 'explainer', attempt = 1): ActiveAgent =>
  ({ agentId, role, job, attempt, startedAt: 1, model: 'opus 5.5' })
