import type { Io } from './io.ts'

import type { ChangeFile } from '../adapters/artifacts.ts'
import { archivedChanges, changeFiles, changeFingerprint, readCurrent } from '../adapters/artifacts.ts'
import { SCHEMA, changeStatus, listChanges, newChange, validateChange } from '../adapters/openspec-cli.ts'
import { parseTasksMd } from '../adapters/tasks-md.ts'
import type { ParsedTask } from '../domain/events.ts'
import { fingerprintOf } from '../plan/hash.ts'
import { allTasksChecked } from '../plan/lifecycle.ts'
import type { PlanEventBody } from '../plan/plan-events.ts'
import { isStale } from '../plan/proposals.ts'
import { readinessChecks } from '../plan/readiness.ts'
import type { ChangeListing, ChangeRecord, PlanBoard, ReadinessCheck } from '../plan/types.ts'
import { changeDir, isPlanChangeName } from '../plan/types.ts'
import { message } from './log-store.ts'
import { appendPlan, readPlan } from './plan-store.ts'

export const tasksOf = (files: readonly ChangeFile[], id: string): readonly ParsedTask[] => {
  const text = files.find(file => file.path === `${changeDir(id)}/tasks.md`)?.text
  return text === undefined ? [] : parseTasksMd(text).tasks
}

export const specFilesOf = (files: readonly ChangeFile[], id: string): ChangeFile[] =>
  files.filter(file => file.path.startsWith(`${changeDir(id)}/specs/`) && file.path.endsWith('.md'))

export async function readinessOf(io: Io, id: string, files: readonly ChangeFile[]): Promise<ReadinessCheck[]> {
  const checked = await validateChange(io, id)
  const validate = checked.ok ? { ok: checked.value.valid, detail: checked.value.output } : { ok: false, detail: checked.output }
  const planMd = files.find(file => file.path === `${changeDir(id)}/plan.md`)?.text
  return readinessChecks({ validate, specs: specFilesOf(files, id), tasks: tasksOf(files, id), planMd })
}

const failed = (id: string, error: string): ChangeListing => ({ id, archived: false, fingerprint: '', tasks: [], readiness: [], error })

/** One change as the CLI and its files describe it; readiness is reused while the fingerprint is unchanged. */
export async function describeChange(io: Io, id: string, previous?: ChangeRecord): Promise<ChangeListing> {
  if (!isPlanChangeName(id)) return failed(id, `invalid change name: ${id}`)
  try {
    const status = await changeStatus(io, id)
    if (!status.ok) return failed(id, status.output)
    const files = await changeFiles(io, id)
    const fingerprint = fingerprintOf(files)
    const tasks = tasksOf(files, id).map(task => ({ label: task.label, done: task.done }))
    const isSame = previous !== undefined && previous.fingerprint === fingerprint && previous.readiness.length > 0
    const readiness = isSame ? previous.readiness : await readinessOf(io, id, files)
    return { id, archived: false, status: status.value, fingerprint, tasks, readiness }
  } catch (error) {
    return failed(id, message(error))
  }
}

/** After a refresh: mark pending proposals whose files changed stale, and record finished executions. */
async function settle(io: Io, before: PlanBoard, after: PlanBoard, ids: readonly string[]): Promise<PlanBoard> {
  const found = await Promise.all(ids.map(async (id): Promise<PlanEventBody[]> => {
    const rec = after.changes[id]
    if (rec === undefined) return []
    const proposal = rec.proposal
    const moved = proposal?.status === 'pending' && before.changes[id]?.fingerprint !== rec.fingerprint
    const stale = moved && proposal !== undefined && isStale(proposal, await readCurrent(io, proposal.files.map(file => file.path)))
    return [
      ...(stale && proposal !== undefined ? [{ type: 'ProposalStale' as const, changeId: id, proposalId: proposal.id }] : []),
      ...(rec.runStarted && !rec.executionFinished && allTasksChecked(rec.tasks) ? [{ type: 'ExecutionFinished' as const, changeId: id }] : []),
    ]
  }))
  return appendPlan(io, found.flat())
}

export async function refreshChanges(io: Io): Promise<PlanBoard> {
  const before = await readPlan(io)
  const listed = await listChanges(io)
  if (!listed.ok) return appendPlan(io, [{ type: 'ChangesListed', complete: true, changes: [], error: listed.output }])
  const active = await Promise.all(listed.value.map(change => describeChange(io, change.name, before.changes[change.name])))
  const archived = (await archivedChanges(io)).map((id): ChangeListing => ({ id, archived: true, fingerprint: '', tasks: [], readiness: [] }))
  const changes = [...active, ...archived]
  const after = await appendPlan(io, [{ type: 'ChangesListed', complete: true, changes }])
  return settle(io, before, after, changes.map(change => change.id))
}

export async function refreshChange(io: Io, id: string): Promise<PlanBoard> {
  const before = await readPlan(io)
  const listing = await describeChange(io, id, before.changes[id])
  const after = await appendPlan(io, [{ type: 'ChangesListed', complete: false, changes: [listing] }])
  return settle(io, before, after, [id])
}

export async function createChange(io: Io, id: string): Promise<string> {
  if (!isPlanChangeName(id)) return `zboard: invalid change name: ${id}`
  if (await io.fs.exists(changeDir(id))) return `zboard: change ${id} already exists`
  const created = await newChange(io, id, SCHEMA)
  if (!created.ok) {
    await appendPlan(io, [{ type: 'PlanError', hook: 'new change', message: created.output }])
    return `zboard: openspec new change failed: ${created.output}`
  }
  await appendPlan(io, [{ type: 'ChangeCreated', changeId: id }])
  await refreshChange(io, id)
  return `zboard: created ${id}`
}

/** The 5 s poll and FileChanged: refresh the change open in the viewer when its fingerprint moved. */
export async function checkOpenChange(io: Io): Promise<void> {
  const selected = (await io.state.ui.read()).changes.selected
  if (selected === null || !isPlanChangeName(selected)) return
  const rec = (await readPlan(io)).changes[selected]
  if (rec === undefined || rec.archived) return
  if ((await changeFingerprint(io, selected)) !== rec.fingerprint) await refreshChange(io, selected)
}
