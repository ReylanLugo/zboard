import type { Io } from './io.ts'

import { changeFiles, listFiles } from '../adapters/artifacts.ts'
import { judgePrompt } from '../adapters/prompts-plan.ts'
import { readProjectConfig } from '../adapters/config-io.ts'
import { runFile, runnerOf } from '../adapters/test-runner.ts'
import type { JudgeRaw } from '../plan/contracts.ts'
import { parseJudge } from '../plan/contracts.ts'
import type { TestEvidence } from '../plan/findings.ts'
import { canResolve, evidencePath, isCitableTest, normalizeFindings, verifyMarkdown } from '../plan/findings.ts'
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

/** A citable repository-relative path naming a regular file (not a directory or link). */
async function isRegularFile(io: Io, path: string): Promise<boolean> {
  if (!isCitableTest(path)) return false
  try {
    const stat = await io.fs.stat(path)
    return stat.kind === 'file' && !stat.isLink
  } catch {
    return false
  }
}

/**
 * D13.2: zboard runs every citable cited test file once with the project's test command
 * (ptest by default; a run that cannot finish is retried once); the judge never runs commands.
 * A pass proves nothing unless the runner's output reports at least one executed test.
 */
async function evidenceFor(io: Io, files: readonly string[]): Promise<Record<string, TestEvidence>> {
  const root = await io.session.root()
  const runner = runnerOf(await readProjectConfig(io))
  const entries: (readonly [string, TestEvidence])[] = []
  for (const file of [...new Set(files)]) {
    if (!(await isRegularFile(io, file))) {
      entries.push([file, { file, kind: 'unknown', endLine: 'not a repository test file; not run' }])
      continue
    }
    const run = await runFile(io, file, root, runner)
    const kind = run.kind === 'pass' && run.executed < 1 ? 'unknown' : run.kind
    entries.push([file, { file, kind, endLine: run.endLine }])
  }
  return Object.fromEntries(entries)
}

/** Evidence `path:line` files that exist as regular files. */
async function presentPaths(io: Io, raw: readonly JudgeRaw[]): Promise<Set<string>> {
  const paths = [...new Set(raw.flatMap(item => item.evidence.map(evidencePath)).filter((path): path is string => path !== undefined))]
  const checked = await Promise.all(paths.map(async path => ((await isRegularFile(io, path)) ? [path] : [])))
  return new Set(checked.flat())
}

async function record(io: Io, changeId: string, job: JudgeJob, raw: readonly JudgeRaw[] | undefined): Promise<void> {
  const tests = raw === undefined ? {} : await evidenceFor(io, raw.flatMap(item => item.tests))
  const present = raw === undefined ? new Set<string>() : await presentPaths(io, raw)
  const findings = normalizeFindings({ raw, requirements: await requirementsOf(io, changeId), scope: job.requirements, tests, present })
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
