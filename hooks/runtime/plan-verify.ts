import type { Io } from './io.ts'

import { changeFiles, listFiles } from '../adapters/artifacts.ts'
import { judgePrompt } from '../adapters/prompts-plan.ts'
import { runFile } from '../adapters/ptest.ts'
import type { JudgeRaw } from '../plan/contracts.ts'
import { parseJudge } from '../plan/contracts.ts'
import type { TestEvidence } from '../plan/findings.ts'
import { canResolve, isCitableTest, normalizeFindings, verifyMarkdown } from '../plan/findings.ts'
import { actionsFor, affectedRequirements } from '../plan/lifecycle.ts'
import { parseRequirements } from '../plan/readiness.ts'
import type { PlanJob, Resolution } from '../plan/types.ts'
import { SPECS_ARTIFACT, TASKS_ARTIFACT, VERIFY_ARTIFACT, changeDir } from '../plan/types.ts'
import type { Ctx } from './ctx.ts'
import { specFilesOf } from './plan-catalog.ts'
import { proposeFiles } from './plan-draft.ts'
import type { JobHandler } from './plan-runner.ts'
import { startJob } from './plan-runner.ts'
import { appendPlan, readPlan } from './plan-store.ts'

type JudgeJob = Extract<PlanJob, { readonly kind: 'judge' }>

export const MAIN_SPECS_DIR = 'openspec/specs'

async function requirementsOf(io: Io, changeId: string): Promise<string[]> {
  const specs = specFilesOf(await changeFiles(io, changeId), changeId)
  return [...new Set(parseRequirements(specs).map(requirement => requirement.name))]
}

async function prompt(io: Io, changeId: string, job: JudgeJob, gateReason?: string): Promise<string> {
  const specs = specFilesOf(await changeFiles(io, changeId), changeId)
  const mainPaths = (await listFiles(io, MAIN_SPECS_DIR)).filter(path => path.endsWith('.md'))
  const mainSpecs = await Promise.all(mainPaths.map(async path => ({ path, text: await io.fs.read(path) })))
  const all = [...new Set(parseRequirements(specs).map(requirement => requirement.name))]
  return judgePrompt({ changeId, specs, mainSpecs, requirements: job.requirements.length > 0 ? job.requirements : all, gateReason })
}

/** D13.2: zboard runs every citable cited test file once (ptest retries 70/75/124 itself); the judge never runs commands. */
async function evidenceFor(io: Io, files: readonly string[]): Promise<Record<string, TestEvidence>> {
  const root = await io.session.root()
  const entries: (readonly [string, TestEvidence])[] = []
  for (const file of [...new Set(files)]) {
    if (!isCitableTest(file) || !(await io.fs.exists(file))) {
      entries.push([file, { file, kind: 'unknown', endLine: 'not a repository test file; not run' }])
      continue
    }
    const run = await runFile(io, file, root)
    entries.push([file, { file, kind: run.kind, endLine: run.endLine }])
  }
  return Object.fromEntries(entries)
}

async function record(io: Io, changeId: string, job: JudgeJob, raw: readonly JudgeRaw[] | undefined): Promise<void> {
  const tests = raw === undefined ? {} : await evidenceFor(io, raw.flatMap(item => item.tests))
  const findings = normalizeFindings({ raw, requirements: await requirementsOf(io, changeId), scope: job.requirements, tests })
  await appendPlan(io, [{ type: 'VerifyRecorded', changeId, findings, scope: job.requirements }])
}

export const judgeJob: JobHandler<JudgeJob, { readonly findings: readonly JudgeRaw[] }> = {
  prompt,
  parse: parseJudge,
  done: (io, _ctx, changeId, job, value) => record(io, changeId, job, value.findings),
  failed: (io, _ctx, changeId, job) => record(io, changeId, job, undefined),
}

async function gated(io: Io, changeId: string, action: 'verify' | 'rejudge'): Promise<boolean> {
  const gate = actionsFor((await readPlan(io)).changes[changeId])[action]
  if (!gate.enabled) io.ui.toast(`zboard: ${gate.reason}`)
  return gate.enabled
}

export async function verifyChange(io: Io, ctx: Ctx, changeId: string): Promise<boolean> {
  if (!(await gated(io, changeId, 'verify'))) return false
  return startJob(io, ctx, changeId, { kind: 'judge', requirements: [] })
}

export async function rejudge(io: Io, ctx: Ctx, changeId: string): Promise<boolean> {
  if (!(await gated(io, changeId, 'rejudge'))) return false
  const rec = (await readPlan(io)).changes[changeId]
  const requirements = rec?.verify === undefined ? [] : affectedRequirements(rec.verify.findings, rec.tasks)
  return startJob(io, ctx, changeId, { kind: 'judge', requirements })
}

export async function resolveFinding(io: Io, ctx: Ctx, changeId: string, findingId: string, resolution: Resolution): Promise<boolean> {
  const found = (await readPlan(io)).changes[changeId]?.verify?.findings.find(item => item.id === findingId)
  if (found === undefined) {
    io.ui.toast('zboard: that finding no longer exists')
    return false
  }
  if (!canResolve(found.verdict, resolution)) {
    io.ui.toast(`zboard: ${resolution} is not allowed for a ${found.verdict} finding`)
    return false
  }
  await appendPlan(io, [{ type: 'FindingResolved', changeId, findingId, resolution }])
  const subject = `${found.requirement}${found.scenario === undefined ? '' : ` / ${found.scenario}`}`
  const facts = `Verdict: ${found.verdict}. Evidence: ${found.evidence.join('; ') || 'none'}.`
  const tagging = `Tag it [req: ${found.requirement}] and give it an "Acceptance:" continuation line.`
  if (resolution === 'fix_code') {
    return startJob(io, ctx, changeId, { kind: 'draft', artifact: TASKS_ARTIFACT, finding: found.id, note: `Add exactly one task to tasks.md that changes the code so this requirement holds: ${subject}. ${facts} ${tagging}` })
  }
  if (resolution === 'add_test') {
    return startJob(io, ctx, changeId, { kind: 'draft', artifact: TASKS_ARTIFACT, finding: found.id, note: `Add exactly one TDD task to tasks.md that writes the missing test proving: ${subject}. ${facts} ${tagging}` })
  }
  if (resolution === 'adjust_spec') {
    return startJob(io, ctx, changeId, { kind: 'draft', artifact: SPECS_ARTIFACT, note: `Adjust the delta spec so it states the intended behaviour for: ${subject}. ${facts}` })
  }
  return true
}

/** D13.6: verify.md is written only through an accepted diff proposal. */
export async function proposeVerifyMd(io: Io, changeId: string): Promise<boolean> {
  const rec = (await readPlan(io)).changes[changeId]
  if (rec?.verify === undefined || !rec.verify.passed) {
    io.ui.toast('zboard: the verify run has not passed')
    return false
  }
  const output = rec.status?.artifacts.find(artifact => artifact.id === VERIFY_ARTIFACT)?.path ?? 'verify.md'
  return proposeFiles(io, changeId, { kind: 'draft', artifact: VERIFY_ARTIFACT }, 'verify run passed', [{ path: `${changeDir(changeId)}/${output}`, content: verifyMarkdown(changeId, rec.verify.findings) }])
}
