import type { Io } from './io.ts'

import type { ChangeFile } from '../adapters/artifacts.ts'
import { changeFiles, matchGlob, readCurrent } from '../adapters/artifacts.ts'
import { instructions } from '../adapters/openspec-cli.ts'
import { draftPrompt } from '../adapters/prompts-plan.ts'
import type { DraftAnswer } from '../plan/contracts.ts'
import { parseDraft } from '../plan/contracts.ts'
import { actionsFor } from '../plan/lifecycle.ts'
import { buildProposal, normalizeRel, scopeError } from '../plan/proposals.ts'
import { parseRequirements } from '../plan/readiness.ts'
import { repairInstruction, repairTargets } from '../plan/repair.ts'
import type { DraftJob } from '../plan/types.ts'
import { BRAINSTORM_ARTIFACT, TASKS_ARTIFACT, changeDir } from '../plan/types.ts'
import type { Ctx } from './ctx.ts'
import type { JobHandler } from './plan-runner.ts'
import { specFilesOf } from './plan-catalog.ts'
import { startJob } from './plan-runner.ts'
import { appendPlan, readPlan } from './plan-store.ts'

const matching = (files: readonly ChangeFile[], changeId: string, outputPath: string): ChangeFile[] =>
  files.filter(file => matchGlob(`${changeDir(changeId)}/${outputPath}`, file.path))

async function draftJobPrompt(io: Io, changeId: string, job: DraftJob, gateReason?: string): Promise<string> {
  const instr = await instructions(io, changeId, job.artifact)
  if (!instr.ok) throw new Error(`openspec instructions ${job.artifact} failed: ${instr.output}`)
  const files = await changeFiles(io, changeId)
  const dependencies = instr.value.dependencies.filter(dep => dep.done).flatMap(dep => matching(files, changeId, dep.path))
  const current = matching(files, changeId, instr.value.outputPath)
  const turns = job.artifact === BRAINSTORM_ARTIFACT ? (await readPlan(io)).changes[changeId]?.qa?.turns : undefined
  return draftPrompt({
    changeId, artifact: job.artifact, instructions: instr.value.raw, dependencies, current,
    note: job.note, previous: job.previous, validator: job.validator, group: job.group, turns, gateReason,
  })
}

async function refuse(io: Io, changeId: string, error: string): Promise<false> {
  await appendPlan(io, [{ type: 'PlanError', changeId, hook: 'proposal', message: error }])
  io.ui.toast(`zboard: ${error}`)
  return false
}

/** Turns agent-produced files into one pending proposal; nothing is written here (D8 writes only on accept). */
export async function proposeFiles(io: Io, changeId: string, source: DraftJob, reason: string, files: DraftAnswer['files']): Promise<boolean> {
  const refused = files.map(file => scopeError(file.path, changeId)).find(error => error !== undefined)
  if (refused !== undefined) return refuse(io, changeId, refused)
  const current = await readCurrent(io, files.map(file => normalizeRel(file.path) ?? file.path))
  const id = `${changeId}-${(await io.state.plan.read()).seq + 1}`
  const built = buildProposal({ id, changeId, artifact: source.artifact, reason, files, current, source })
  if (!built.ok) return refuse(io, changeId, built.error)
  await appendPlan(io, [{ type: 'ProposalReady', changeId, proposal: built.proposal }])
  return true
}

const reasonOf = (job: DraftJob, notes: string): string =>
  (notes.trim() !== '' ? notes.trim() : job.note !== undefined ? `comment: ${job.note}` : `draft ${job.artifact}`)

export const draftJob: JobHandler<DraftJob, DraftAnswer> = {
  prompt: draftJobPrompt,
  parse: parseDraft,
  done: async (io, _ctx, changeId, job, value) => {
    await proposeFiles(io, changeId, job, reasonOf(job, value.notes), value.files)
  },
}

export async function commentOn(io: Io, ctx: Ctx, changeId: string, artifact: string, text: string): Promise<boolean> {
  const note = text.trim()
  if (note === '') return false
  const gate = actionsFor((await readPlan(io)).changes[changeId]).comment
  if (!gate.enabled) {
    io.ui.toast(`zboard: ${gate.reason}`)
    return false
  }
  return startJob(io, ctx, changeId, { kind: 'draft', artifact, note })
}

/** Asks the drafter to add req tags and acceptance lines to tasks.md, as a comment: the result is a normal pending proposal. */
export async function repairTasks(io: Io, ctx: Ctx, changeId: string): Promise<boolean> {
  const rec = (await readPlan(io)).changes[changeId]
  if (rec === undefined) return false
  const requirements = parseRequirements(specFilesOf(await changeFiles(io, changeId), changeId)).map(requirement => requirement.name)
  return commentOn(io, ctx, changeId, TASKS_ARTIFACT, repairInstruction([...new Set(requirements)], repairTargets(rec.readiness)))
}
