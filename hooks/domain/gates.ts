import { extractJson, isRecord, stringArray, unique } from './json.ts'
import { normalizeInside } from './paths.ts'
import type { Finding, Phase, ReviewVerdict } from './types.ts'

export type GateOutcome =
  | {
      readonly gate: 'pass'
      readonly summary: string
      readonly allowedFiles?: readonly string[]
      readonly testFiles?: readonly string[]
      readonly verdict?: ReviewVerdict
      readonly newTests?: readonly string[]
    }
  | { readonly gate: 'fail'; readonly reason: string; readonly terminal: boolean }

export const fail = (reason: string, terminal = false): GateOutcome => ({ gate: 'fail', reason, terminal })

const EVIDENCE = /^[^\s:]+:\d+(-\d+)?$/
const SEVERITIES = new Set(['high', 'medium', 'low'])

export function researchGate(answer: string): GateOutcome {
  const json = extractJson(answer)
  if (!isRecord(json) || !Array.isArray(json.findings)) return fail('research: no valid JSON with a findings array')
  const evidenced = json.findings.filter(
    finding => isRecord(finding) && typeof finding.evidence === 'string' && EVIDENCE.test(finding.evidence.trim()),
  )
  if (evidenced.length === 0) return fail('research: no finding carries path:line evidence')
  return { gate: 'pass', summary: `${evidenced.length} evidenced finding(s)` }
}

export function planGate(answer: string, root: string): GateOutcome {
  const json = extractJson(answer)
  if (!isRecord(json)) return fail('plan: no valid JSON object')
  const allowed = stringArray(json.allowedFiles) ?? []
  const tests = stringArray(json.testFiles) ?? []
  if (allowed.length === 0) return fail('plan: allowedFiles is empty')
  if (tests.length === 0) return fail('plan: testFiles is empty')
  if (!Array.isArray(json.testCases) || json.testCases.length === 0) return fail('plan: testCases is empty')
  const outside = [...allowed, ...tests].filter(path => normalizeInside(path, root) === undefined)
  if (outside.length > 0) return fail(`plan: paths outside the repository: ${outside.join(', ')}`)
  const inside = (paths: readonly string[]): string[] => unique(paths.map(path => normalizeInside(path, root) ?? path))
  return {
    gate: 'pass',
    summary: `${allowed.length} allowed file(s), ${json.testCases.length} test case(s)`,
    allowedFiles: inside(allowed),
    testFiles: inside(tests),
  }
}

const isFinding = (value: unknown): value is Finding =>
  isRecord(value) &&
  typeof value.severity === 'string' && SEVERITIES.has(value.severity) &&
  typeof value.file === 'string' &&
  typeof value.issue === 'string' &&
  (value.line === undefined || typeof value.line === 'number')

export function reviewGate(answer: string): GateOutcome {
  const json = extractJson(answer)
  if (!isRecord(json) || (json.verdict !== 'approve' && json.verdict !== 'changes') || !Array.isArray(json.findings)) {
    return fail('review: no valid ReviewVerdict JSON')
  }
  const findings = json.findings.filter(isFinding)
  if (findings.length !== json.findings.length) return fail('review: a finding is malformed')
  if (json.verdict === 'changes' && findings.length === 0) return fail('review: verdict "changes" without findings')
  return {
    gate: 'pass',
    summary: `${json.verdict} (${findings.length} finding${findings.length === 1 ? '' : 's'})`,
    verdict: { verdict: json.verdict, findings },
  }
}

export function touchedGate(touched: readonly string[], allowed: readonly string[], phase: Phase): GateOutcome | undefined {
  const extra = touched.filter(path => !allowed.includes(path))
  return extra.length === 0 ? undefined : fail(`${phase}: changed files outside its scope: ${extra.join(', ')}`)
}

export interface TestRun {
  readonly kind: 'pass' | 'fail' | 'incomplete' | 'unknown'
  readonly endLine: string
  readonly failures: readonly string[]
  /** The configured test command as displayed (e.g. `uv run pytest <file>`); absent for ptest. */
  readonly runner?: string
}

/** How gate messages name the runner: `ptest`, or the configured command in backticks. */
const runnerLabel = (run: TestRun): string => (run.runner === undefined ? 'ptest' : `\`${run.runner}\``)

function unusable(run: TestRun): GateOutcome | undefined {
  if (run.kind === 'incomplete') return fail(`${runnerLabel(run)} incomplete twice: ${run.endLine}`, true)
  if (run.kind === 'unknown') return fail(`${runnerLabel(run)} result unknown: ${run.endLine}`)
  return undefined
}

export function tddTestFiles(answer: string, root: string): string[] {
  const json = extractJson(answer)
  const files = isRecord(json) ? (stringArray(json.testFiles) ?? []) : []
  return unique(files.map(path => normalizeInside(path, root)).filter((path): path is string => path !== undefined))
}

const MIN_TEST_NAME = 3

/** A failure is that test when it is its node id, or a pytest (`::`) or vitest (` > `) id ending with it. */
const namesTest = (failure: string, name: string): boolean =>
  failure === name || failure.endsWith(`::${name}`) || failure.endsWith(` > ${name}`)

export function tddGate(run: TestRun, answer: string): GateOutcome {
  const blocked = unusable(run)
  if (blocked !== undefined) return blocked
  if (run.kind === 'pass') return fail('tdd: tests passed; RED was not observed')
  const json = extractJson(answer)
  const newTests = isRecord(json) ? (stringArray(json.newTests) ?? []) : []
  if (newTests.length === 0) return fail('tdd: artifact lists no newTests')
  const short = newTests.find(name => name.trim().length < MIN_TEST_NAME)
  if (short !== undefined) return fail(`tdd: newTests has an empty or too short name: ${JSON.stringify(short)}`)
  if (run.failures.length === 0) return fail(`tdd: ${runnerLabel(run)} failed but no failing test could be identified`)
  // A declared test file that cannot load yet (its module is missing) fails as a whole, under the file's name.
  const declaredFiles = isRecord(json) ? (stringArray(json.testFiles) ?? []) : []
  const isOwnFile = (failure: string): boolean =>
    declaredFiles.some(file => failure === file || failure.endsWith(`/${file}`) || file.endsWith(`/${failure}`))
  const foreign = run.failures.filter(failure => !isOwnFile(failure) && !newTests.some(name => namesTest(failure, name.trim())))
  if (foreign.length > 0) return fail(`tdd: pre-existing tests fail: ${foreign.join(', ')}`)
  return { gate: 'pass', summary: `RED: ${run.failures.length} new failing test(s)`, newTests }
}

export function greenGate(run: TestRun, phase: 'code' | 'refactor'): GateOutcome {
  const blocked = unusable(run)
  if (blocked !== undefined) return blocked
  if (run.kind === 'fail') return fail(`${phase}: tests fail: ${run.failures.slice(0, 5).join(', ') || run.endLine}`)
  return { gate: 'pass', summary: `GREEN: ${run.endLine}` }
}
