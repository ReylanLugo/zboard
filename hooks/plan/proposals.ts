import { unifiedDiff } from './diff.ts'
import type { DiffProposal, DraftJob, ProposalFile } from './types.ts'
import { changeDir } from './types.ts'

/** Repo-relative normal form, or undefined for absolute, drive, backslash, NUL or `..` spellings. */
export function normalizeRel(path: string): string | undefined {
  if (path === '' || path.startsWith('/') || path.includes('\\') || path.includes('\u0000') || /^[A-Za-z]:/.test(path)) return undefined
  const parts = path.split('/').filter(part => part !== '' && part !== '.')
  return parts.includes('..') || parts.length === 0 ? undefined : parts.join('/')
}

/** D7 write scope: only `openspec/changes/<own id>/…`; checked when a proposal is built and again when applied. */
export function scopeError(path: string, changeId: string): string | undefined {
  const normal = normalizeRel(path)
  if (normal === undefined) return `refused path ${path}: absolute, traversal or malformed`
  if (normal.startsWith('openspec/specs/')) return `refused path ${path}: only openspec archive writes openspec/specs/`
  if (!normal.startsWith(`${changeDir(changeId)}/`)) return `refused path ${path}: outside openspec/changes/${changeId}/`
  return undefined
}

export interface ProposalInput {
  readonly id: string
  readonly changeId: string
  readonly artifact: string
  readonly reason: string
  readonly files: readonly { readonly path: string; readonly content: string }[]
  /** Current content keyed by normalized path; null when the file does not exist. */
  readonly current: Readonly<Record<string, string | null>>
  readonly source: DraftJob
}

export type Built = { readonly ok: true; readonly proposal: DiffProposal } | { readonly ok: false; readonly error: string }

export function buildProposal(input: ProposalInput): Built {
  if (input.files.length === 0) return { ok: false, error: 'the proposal changes no file' }
  const refused = input.files.map(file => scopeError(file.path, input.changeId)).find(error => error !== undefined)
  if (refused !== undefined) return { ok: false, error: refused }
  const normalized = input.files.map(file => ({ path: normalizeRel(file.path) ?? file.path, content: file.content }))
  const paths = normalized.map(file => file.path)
  const repeated = paths.find((path, index) => paths.indexOf(path) !== index)
  if (repeated !== undefined) return { ok: false, error: `the proposal names ${repeated} twice` }
  const files: ProposalFile[] = normalized.flatMap(file => {
    const before = input.current[file.path] ?? null
    return before === file.content ? [] : [{ path: file.path, before, after: file.content }]
  })
  if (files.length === 0) return { ok: false, error: 'the proposal changes nothing' }
  return { ok: true, proposal: { id: input.id, artifact: input.artifact, reason: input.reason, files, status: 'pending', source: input.source } }
}

export const staleFiles = (p: DiffProposal, current: Readonly<Record<string, string | null>>): string[] =>
  p.files.filter(file => (current[file.path] ?? null) !== file.before).map(file => file.path)

export const isStale = (p: DiffProposal, current: Readonly<Record<string, string | null>>): boolean => staleFiles(p, current).length > 0

export type RevertStep =
  | { readonly kind: 'write'; readonly path: string; readonly text: string }
  | { readonly kind: 'remove'; readonly path: string }

export const revertSteps = (p: DiffProposal): RevertStep[] =>
  p.files.map(file => (file.before === null ? { kind: 'remove', path: file.path } : { kind: 'write', path: file.path, text: file.before }))

export const proposalText = (p: DiffProposal): string => p.files.map(file => unifiedDiff(file.path, file.before, file.after)).join('\n')
