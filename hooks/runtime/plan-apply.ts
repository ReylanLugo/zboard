import type { Io } from './io.ts'

import { listFiles, readCurrent, removeFile, writeText } from '../adapters/artifacts.ts'
import { commitTask } from '../adapters/git.ts'
import type { CliResult, Validation } from '../adapters/openspec-cli.ts'
import { validateChange } from '../adapters/openspec-cli.ts'
import { parseTasksMd } from '../adapters/tasks-md.ts'
import { actionsFor } from '../plan/lifecycle.ts'
import type { PlanEventBody } from '../plan/plan-events.ts'
import { isStale, proposalText, revertSteps, scopeError } from '../plan/proposals.ts'
import type { DiffProposal } from '../plan/types.ts'
import { RETRO_ARTIFACT, changeDir } from '../plan/types.ts'
import type { Ctx } from './ctx.ts'
import { refreshChange } from './plan-catalog.ts'
import { serialized, startJob } from './plan-runner.ts'
import { appendPlan, readPlan } from './plan-store.ts'

export type AcceptListener = (io: Io, ctx: Ctx, changeId: string, proposal: DiffProposal) => Promise<void>

const acceptListeners: AcceptListener[] = []

export const onProposalAccepted = (listener: AcceptListener): void => {
  acceptListeners.push(listener)
}

export const revisionMessage = (changeId: string, artifact: string, n: number): string => `docs(${changeId}): ${artifact} rev ${n}`

export const STALE_NOTE = 'The files changed since the previous proposal; draft it again from their current content.'

async function restore(io: Io, p: DiffProposal): Promise<void> {
  for (const step of revertSteps(p)) {
    if (step.kind === 'write') await writeText(io, step.path, step.text)
    else await removeFile(io, step.path)
  }
}

/**
 * Whether a validation result blocks an accepted proposal. openspec reports "no deltas" for every
 * change until its first delta spec exists, so that issue alone does not block while specs/ is empty.
 */
async function isBlocking(io: Io, changeId: string, checked: CliResult<Validation>): Promise<boolean> {
  if (!checked.ok) return true
  if (checked.value.valid) return false
  if (!checked.value.onlyNoDelta) return true
  return (await listFiles(io, `${changeDir(changeId)}/specs`)).length > 0
}

/** The tasks.md label a fix_code/add_test proposal added, to link it to its finding. */
function addedTask(before: string | null, after: string | undefined): string | undefined {
  if (after === undefined) return undefined
  const known = new Set(before === null ? [] : parseTasksMd(before).tasks.map(task => task.label))
  return parseTasksMd(after).tasks.map(task => task.label).find(label => !known.has(label))
}

async function applyAccepted(io: Io, ctx: Ctx, changeId: string): Promise<void> {
  const rec = (await readPlan(io)).changes[changeId]
  const p = rec?.proposal
  const gate = actionsFor(rec).accept
  if (rec === undefined || p === undefined || !gate.enabled) {
    io.ui.toast(`zboard: ${gate.reason}`)
    return
  }
  const refused = p.files.map(file => scopeError(file.path, changeId)).find(error => error !== undefined)
  if (refused !== undefined) {
    await appendPlan(io, [{ type: 'PlanError', changeId, hook: 'apply', message: refused }, { type: 'ProposalRejected', changeId, proposalId: p.id }])
    return
  }
  const paths = p.files.map(file => file.path)
  const current = await readCurrent(io, paths)
  if (isStale(p, current)) {
    await appendPlan(io, [{ type: 'ProposalStale', changeId, proposalId: p.id }])
    io.ui.toast('zboard: the files changed since this proposal; nothing was written — regenerate it')
    return
  }
  for (const file of p.files) await writeText(io, file.path, file.after)
  const checked = await validateChange(io, changeId)
  if (await isBlocking(io, changeId, checked)) {
    const output = checked.ok ? checked.value.output : checked.output
    await restore(io, p)
    await appendPlan(io, [{ type: 'PlanError', changeId, hook: 'validate', message: output }, { type: 'ProposalRejected', changeId, proposalId: p.id }])
    io.ui.toast(`zboard: openspec validate failed; ${p.artifact} was restored and a correction was requested`)
    await startJob(io, ctx, changeId, { ...p.source, previous: proposalText(p), validator: output })
    return
  }
  const n = rec.revisions.filter(revision => revision.artifact === p.artifact).length + 1
  const committed = await commitTask(io, { cwd: await io.session.root(), paths, message: revisionMessage(changeId, p.artifact, n) })
  if (!committed.ok) {
    await restore(io, p)
    await appendPlan(io, [{ type: 'PlanError', changeId, hook: 'commit', message: committed.reason }])
    io.ui.toast(`zboard: ${committed.reason}; the files were restored`)
    return
  }
  const tasksPath = `${changeDir(changeId)}/tasks.md`
  const finding = p.source.finding
  const task = finding === undefined ? undefined : addedTask(current[tasksPath] ?? null, p.files.find(file => file.path === tasksPath)?.after)
  const at = await io.clock.now()
  const events: PlanEventBody[] = [
    {
      type: 'ProposalAccepted', changeId, proposalId: p.id, revision: { proposalId: p.id, artifact: p.artifact, commit: committed.sha, at },
      ...(finding !== undefined && task !== undefined ? { linked: { findingId: finding, task } } : {}),
    },
    ...(p.artifact === RETRO_ARTIFACT ? [{ type: 'RetrospectiveAccepted' as const, changeId }] : []),
  ]
  await appendPlan(io, events)
  await refreshChange(io, changeId)
  for (const listener of acceptListeners) await listener(io, ctx, changeId, p)
}

/** D8; serialized per change so two presses before the redraw apply once. */
export const acceptProposal = (io: Io, ctx: Ctx, changeId: string): Promise<void> =>
  serialized(`apply:${changeId}`, () => applyAccepted(io, ctx, changeId))

export async function rejectProposal(io: Io, changeId: string): Promise<void> {
  const rec = (await readPlan(io)).changes[changeId]
  const gate = actionsFor(rec).reject
  if (rec?.proposal === undefined || !gate.enabled) {
    io.ui.toast(`zboard: ${gate.reason}`)
    return
  }
  await appendPlan(io, [{ type: 'ProposalRejected', changeId, proposalId: rec.proposal.id }])
}

export async function askAnother(io: Io, ctx: Ctx, changeId: string, note: string): Promise<boolean> {
  const rec = (await readPlan(io)).changes[changeId]
  const p = rec?.proposal
  const gate = actionsFor(rec).regenerate
  if (p === undefined || !gate.enabled) {
    io.ui.toast(`zboard: ${gate.reason}`)
    return false
  }
  await appendPlan(io, [{ type: 'ProposalRejected', changeId, proposalId: p.id }])
  const notes = [p.source.note, note.trim()].filter((text): text is string => text !== undefined && text !== '')
  return startJob(io, ctx, changeId, { ...p.source, previous: proposalText(p), ...(notes.length === 0 ? {} : { note: notes.join('\n\n') }) })
}

export const regenerateProposal = (io: Io, ctx: Ctx, changeId: string): Promise<boolean> => askAnother(io, ctx, changeId, STALE_NOTE)
