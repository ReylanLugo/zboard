import type { JudgeRaw } from './contracts.ts'
import { normalizeRel } from './proposals.ts'
import type { Finding, Resolution, Verdict } from './types.ts'

export interface TestEvidence {
  readonly file: string
  readonly kind: 'pass' | 'fail' | 'incomplete' | 'unknown'
  readonly endLine: string
}

export const VERDICTS: readonly Verdict[] = ['true', 'false', 'no_evidence', 'ambiguous', 'contradiction']

/** D13.4 resolution table. */
export const ALLOWED: Readonly<Record<Verdict, readonly Resolution[]>> = {
  true: [],
  false: ['fix_code', 'adjust_spec'],
  contradiction: ['fix_code', 'adjust_spec'],
  no_evidence: ['add_test', 'accepted'],
  ambiguous: ['adjust_spec', 'fix_code', 'accepted'],
}

const PATH_LINE = /^[^\s:]+:\d+(?::\d+)?$/

export const canResolve = (verdict: Verdict, resolution: Resolution): boolean => ALLOWED[verdict].includes(resolution)

const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export const findingId = (requirement: string, scenario?: string): string =>
  `r:${slug(requirement)}${scenario === undefined ? '' : `#${slug(scenario)}`}`

/** A judge-cited test may run only as a plain repository-relative path with no option-like segment. */
export const isCitableTest = (path: string): boolean =>
  normalizeRel(path) === path && !path.split('/').some(part => part.startsWith('-'))

export interface NormalizeInput {
  readonly raw: readonly JudgeRaw[] | undefined
  readonly requirements: readonly string[]
  readonly scope: readonly string[]
  readonly tests: Readonly<Record<string, TestEvidence>>
  /** Repository-relative evidence paths that exist as regular files. */
  readonly present: ReadonlySet<string>
}

/** The file of a `path:line` evidence entry, or undefined for prose evidence. */
export const evidencePath = (item: string): string | undefined => {
  const trimmed = item.trim()
  return PATH_LINE.test(trimmed) ? trimmed.slice(0, trimmed.indexOf(':')) : undefined
}

/**
 * A `true` stands only on proof: at least one cited test, every cited test run and passing,
 * and at least one `path:line` evidence entry, each naming a file that exists.
 */
function isProven(raw: JudgeRaw, runs: readonly TestEvidence[], present: ReadonlySet<string>): boolean {
  const paths = raw.evidence.map(evidencePath).filter((path): path is string => path !== undefined)
  return runs.length > 0 && runs.every(run => run.kind === 'pass')
    && paths.length > 0 && paths.every(path => isCitableTest(path) && present.has(path))
}

const noEvidence = (requirement: string, why: string): Finding => ({ id: findingId(requirement), requirement, verdict: 'no_evidence', evidence: [why] })

function normalizeOne(raw: JudgeRaw, tests: Readonly<Record<string, TestEvidence>>, present: ReadonlySet<string>): Finding {
  const verdict = VERDICTS.find(known => known === raw.verdict) ?? 'ambiguous'
  const runs = raw.tests.map(file => tests[file] ?? { file, kind: 'unknown' as const, endLine: 'not run' })
  const evidence = [...raw.evidence, ...runs.map(run => `ptest ${run.file}: ${run.endLine}`)]
  const base = { id: findingId(raw.requirement, raw.scenario), requirement: raw.requirement, ...(raw.scenario === undefined ? {} : { scenario: raw.scenario }), evidence }
  if (verdict !== 'true') return { ...base, verdict }
  return { ...base, verdict: isProven(raw, runs, present) ? 'true' : 'no_evidence' }
}

/** D13.3: zboard never produces `true` on its own. */
export function normalizeFindings(input: NormalizeInput): Finding[] {
  const judged = input.scope.length === 0 ? input.requirements : input.requirements.filter(name => input.scope.includes(name))
  if (input.raw === undefined) return judged.map(name => noEvidence(name, 'the judge gave no valid answer'))
  const relevant = input.raw.filter(raw => judged.includes(raw.requirement))
  const findings = relevant.map(raw => normalizeOne(raw, input.tests, input.present))
  const unique = findings.filter((finding, index) => findings.findIndex(other => other.id === finding.id) === index)
  const omitted = judged.filter(name => !relevant.some(raw => raw.requirement === name))
  return [...unique, ...omitted.map(name => noEvidence(name, 'the judge gave no verdict'))]
}

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ')

export function verifyMarkdown(changeId: string, findings: readonly Finding[]): string {
  const rows = findings.map(f => `| ${cell(f.requirement)} | ${cell(f.scenario ?? '–')} | ${f.verdict} | ${f.resolution ?? '–'} | ${cell(f.evidence.join('; ') || '–')} |`)
  const accepted = findings.filter(f => f.resolution === 'accepted').map(f => `- ${f.requirement}${f.scenario === undefined ? '' : ` / ${f.scenario}`}: ${f.verdict}, accepted without evidence`)
  return [
    `# Verify: ${changeId}`, '',
    '| Requirement | Scenario | Verdict | Resolution | Evidence |', '|---|---|---|---|---|', ...rows, '',
    '## Accepted risks', '', ...(accepted.length === 0 ? ['None.'] : accepted), '',
  ].join('\n')
}
