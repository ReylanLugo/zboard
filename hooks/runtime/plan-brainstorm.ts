import type { Io } from './io.ts'

import { instructions } from '../adapters/openspec-cli.ts'
import { brainstormPrompt } from '../adapters/prompts-plan.ts'
import type { BrainstormAnswer } from '../plan/contracts.ts'
import { parseBrainstorm } from '../plan/contracts.ts'
import type { PlanJob } from '../plan/types.ts'
import { BRAINSTORM_ARTIFACT, QA_CAP, changeDir } from '../plan/types.ts'
import type { Ctx } from './ctx.ts'
import { proposeFiles } from './plan-draft.ts'
import type { JobHandler } from './plan-runner.ts'
import { startJob } from './plan-runner.ts'
import { appendPlan, readPlan } from './plan-store.ts'

type BrainstormJob = Extract<PlanJob, { readonly kind: 'brainstorm' }>

async function prompt(io: Io, changeId: string, job: BrainstormJob, gateReason?: string): Promise<string> {
  const instr = await instructions(io, changeId, BRAINSTORM_ARTIFACT)
  if (!instr.ok) throw new Error(`openspec instructions ${BRAINSTORM_ARTIFACT} failed: ${instr.output}`)
  const turns = (await readPlan(io)).changes[changeId]?.qa?.turns ?? []
  return brainstormPrompt({ changeId, instructions: instr.value.raw, turns, finish: job.finish, gateReason })
}

async function done(io: Io, _ctx: Ctx, changeId: string, _job: BrainstormJob, value: BrainstormAnswer): Promise<void> {
  const rec = (await readPlan(io)).changes[changeId]
  if (value.kind === 'done') {
    await appendPlan(io, [{ type: 'QaFinished', changeId, capped: false }])
    const output = rec?.status?.artifacts.find(a => a.id === BRAINSTORM_ARTIFACT)?.path ?? 'brainstorm.md'
    await proposeFiles(io, changeId, { kind: 'draft', artifact: BRAINSTORM_ARTIFACT }, 'brainstorm Q&A finished', [{ path: `${changeDir(changeId)}/${output}`, content: value.brainstorm }])
    return
  }
  const answered = (rec?.qa?.turns ?? []).filter(turn => turn.answer !== undefined).length
  if (answered >= QA_CAP) {
    await appendPlan(io, [{ type: 'QaFinished', changeId, capped: true }])
    io.ui.toast(`zboard: the Q&A reached ${QA_CAP} answers; draft brainstorm.md from the turns`)
    return
  }
  await appendPlan(io, [{ type: 'QaAsked', changeId, question: value.question, options: value.options, why: value.why }])
}

export const brainstormJob: JobHandler<BrainstormJob, BrainstormAnswer> = { prompt, parse: parseBrainstorm, done }

export const startBrainstorm = (io: Io, ctx: Ctx, changeId: string): Promise<boolean> =>
  startJob(io, ctx, changeId, { kind: 'brainstorm', finish: false })

export async function answerQuestion(io: Io, ctx: Ctx, changeId: string, answer: string): Promise<boolean> {
  const text = answer.trim()
  if (text === '') return false
  const qa = (await readPlan(io)).changes[changeId]?.qa
  const last = qa?.turns.at(-1)
  if (qa === undefined || qa.done || last === undefined || last.answer !== undefined) {
    io.ui.toast('zboard: there is no open question')
    return false
  }
  await appendPlan(io, [{ type: 'QaAnswered', changeId, answer: text }])
  const answered = qa.turns.filter(turn => turn.answer !== undefined).length + 1
  return startJob(io, ctx, changeId, { kind: 'brainstorm', finish: answered >= QA_CAP })
}

export const finishBrainstorm = (io: Io, ctx: Ctx, changeId: string): Promise<boolean> =>
  startJob(io, ctx, changeId, { kind: 'brainstorm', finish: true })

export const draftFromTurns = (io: Io, ctx: Ctx, changeId: string): Promise<boolean> =>
  startJob(io, ctx, changeId, { kind: 'draft', artifact: BRAINSTORM_ARTIFACT })
