import { extractJson, isRecord, stringArray } from '../domain/json.ts'
import type { CritiqueFinding, Explanation } from './types.ts'

export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string }

export type BrainstormAnswer =
  | { readonly kind: 'question'; readonly question: string; readonly options: readonly string[]; readonly why: string }
  | { readonly kind: 'done'; readonly brainstorm: string }

export interface DraftAnswer {
  readonly files: readonly { readonly path: string; readonly content: string }[]
  readonly notes: string
}

export interface JudgeRaw {
  readonly requirement: string
  readonly scenario?: string
  readonly verdict: string
  readonly evidence: readonly string[]
  readonly tests: readonly string[]
}

export const OPTIONS_MAX = 6
const SEVERITIES = ['high', 'medium', 'low'] as const

const bad = (reason: string): { readonly ok: false; readonly reason: string } => ({ ok: false, reason })
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

function objectOf(answer: string | undefined): Parsed<Record<string, unknown>> {
  if (answer === undefined || answer.trim() === '') return bad('the agent gave no answer')
  const value = extractJson(answer)
  return isRecord(value) ? { ok: true, value } : bad('no valid ```json block with an object')
}

function listOf<T>(value: unknown, field: string, item: (entry: Record<string, unknown>) => T | undefined, message: string): Parsed<T[]> {
  if (!Array.isArray(value)) return bad(`"${field}" must be an array`)
  const items = value.flatMap(entry => { const parsed = isRecord(entry) ? item(entry) : undefined; return parsed === undefined ? [] : [parsed] })
  return items.length === value.length ? { ok: true, value: items } : bad(message)
}

export function parseBrainstorm(answer: string | undefined): Parsed<BrainstormAnswer> {
  const out = objectOf(answer)
  if (!out.ok) return out
  const v = out.value
  if (v.done === true) return isText(v.brainstorm) ? { ok: true, value: { kind: 'done', brainstorm: v.brainstorm } } : bad('done needs a non-empty "brainstorm"')
  const options = stringArray(v.options)
  if (!isText(v.question) || options === undefined || !isText(v.why)) return bad('a question needs "question", "options" (strings) and "why"')
  if (options.length > OPTIONS_MAX) return bad(`at most ${OPTIONS_MAX} options`)
  return { ok: true, value: { kind: 'question', question: v.question, options, why: v.why } }
}

export function parseDraft(answer: string | undefined): Parsed<DraftAnswer> {
  const out = objectOf(answer)
  if (!out.ok) return out
  if (!Array.isArray(out.value.files) || out.value.files.length === 0) return bad('"files" must list at least one file')
  const files = listOf(out.value.files, 'files', entry =>
    (typeof entry.path === 'string' && typeof entry.content === 'string' ? { path: entry.path, content: entry.content } : undefined),
  'every file needs a string "path" and "content"')
  if (!files.ok) return files
  return { ok: true, value: { files: files.value, notes: typeof out.value.notes === 'string' ? out.value.notes : '' } }
}

export function parseExplanation(answer: string | undefined): Parsed<Explanation> {
  const out = objectOf(answer)
  if (!out.ok) return out
  if (!isText(out.value.overview)) return bad('"overview" must be non-empty text')
  const sections = listOf(out.value.sections, 'sections', entry =>
    (typeof entry.title === 'string' && typeof entry.body === 'string' ? { title: entry.title, body: entry.body } : undefined), 'every section needs "title" and "body"')
  if (!sections.ok) return sections
  const diagrams = listOf(out.value.diagrams, 'diagrams', entry =>
    (typeof entry.title === 'string' && isText(entry.mermaid) ? { title: entry.title, mermaid: entry.mermaid } : undefined), 'every diagram needs "title" and "mermaid"')
  if (!diagrams.ok) return diagrams
  return { ok: true, value: { overview: out.value.overview, sections: sections.value, diagrams: diagrams.value } }
}

const artifactId = (value: string): string => value.replace(/^.*\//, '').replace(/\.md$/, '')

export function parseCritique(answer: string | undefined): Parsed<{ readonly findings: readonly CritiqueFinding[] }> {
  const out = objectOf(answer)
  if (!out.ok) return out
  const findings = listOf(out.value.findings, 'findings', entry => {
    const severity = SEVERITIES.find(known => known === entry.severity)
    return severity !== undefined && isText(entry.artifact) && isText(entry.issue) && typeof entry.suggestion === 'string'
      ? { severity, artifact: artifactId(entry.artifact), issue: entry.issue, suggestion: entry.suggestion }
      : undefined
  }, 'every finding needs severity high|medium|low, artifact, issue and suggestion')
  return findings.ok ? { ok: true, value: { findings: findings.value } } : findings
}

export function parseJudge(answer: string | undefined): Parsed<{ readonly findings: readonly JudgeRaw[] }> {
  const out = objectOf(answer)
  if (!out.ok) return out
  const findings = listOf(out.value.findings, 'findings', entry => (isText(entry.requirement) && typeof entry.verdict === 'string'
    ? {
      requirement: entry.requirement,
      ...(isText(entry.scenario) ? { scenario: entry.scenario } : {}),
      verdict: entry.verdict,
      evidence: stringArray(entry.evidence) ?? [],
      tests: stringArray(entry.tests) ?? [],
    }
    : undefined), 'every finding needs "requirement" and "verdict"')
  return findings.ok ? { ok: true, value: { findings: findings.value } } : findings
}
