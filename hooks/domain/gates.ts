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
}

function unusable(run: TestRun): GateOutcome | undefined {
  if (run.kind === 'incomplete') return fail(`ptest incomplete twice: ${run.endLine}`, true)
  if (run.kind === 'unknown') return fail(`ptest result unknown: ${run.endLine}`)
  return undefined
}

export function tddTestFiles(answer: string, root: string): string[] {
  const json = extractJson(answer)
  const files = isRecord(json) ? (stringArray(json.testFiles) ?? []) : []
  return unique(files.map(path => normalizeInside(path, root)).filter((path): path is string => path !== undefined))
}

export function tddGate(run: TestRun, answer: string): GateOutcome {
  const blocked = unusable(run)
  if (blocked !== undefined) return blocked
  if (run.kind === 'pass') return fail('tdd: tests passed; RED was not observed')
  const json = extractJson(answer)
  const newTests = isRecord(json) ? (stringArray(json.newTests) ?? []) : []
  if (newTests.length === 0) return fail('tdd: artifact lists no newTests')
  if (run.failures.length === 0) return fail('tdd: ptest failed but no failing test could be identified')
  const foreign = run.failures.filter(failure => !newTests.some(name => failure.includes(name)))
  if (foreign.length > 0) return fail(`tdd: pre-existing tests fail: ${foreign.join(', ')}`)
  return { gate: 'pass', summary: `RED: ${run.failures.length} new failing test(s)`, newTests }
}

export function greenGate(run: TestRun, phase: 'code' | 'refactor'): GateOutcome {
  const blocked = unusable(run)
  if (blocked !== undefined) return blocked
  if (run.kind === 'fail') return fail(`${phase}: tests fail: ${run.failures.slice(0, 5).join(', ') || run.endLine}`)
  return { gate: 'pass', summary: `GREEN: ${run.endLine}` }
}
