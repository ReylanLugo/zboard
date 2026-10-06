import type { Io } from '../runtime/io.ts'

import { isRecord, stringArray } from '../domain/json.ts'
import type { ArtifactState, ArtifactStatus, CliStatus } from '../plan/types.ts'
import { isPlanChangeName } from '../plan/types.ts'

export const OPENSPEC_TIMEOUT_MS = 60_000
export const SCHEMA = 'superpowers-bridge'
const OUTPUT_MAX = 2_000
const ARTIFACT_ID = /^[a-z][a-z0-9-]*$/
const STATUSES: readonly ArtifactStatus[] = ['blocked', 'ready', 'done']

export type CliResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly output: string }

export interface ListedChange {
  readonly name: string
  readonly completedTasks: number
  readonly totalTasks: number
  readonly status: string
}

export interface Dependency {
  readonly id: string
  readonly done: boolean
  readonly path: string
}

export interface Instructions {
  readonly artifactId: string
  readonly outputPath: string
  readonly dependencies: readonly Dependency[]
  /** The CLI's whole JSON answer, handed to the drafter as data. */
  readonly raw: string
}

export interface Validation {
  readonly valid: boolean
  readonly output: string
}

interface Ran {
  readonly exitCode: number
  readonly stdout: string
  readonly output: string
}

const fail = (output: string): { readonly ok: false; readonly output: string } =>
  ({ ok: false, output: output.trim().slice(0, OUTPUT_MAX) || 'openspec gave no output' })

const invalidName = (id: string) => fail(`invalid change name: ${id}`)

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/** Argv only, no shell, from the repository root, with an explicit timeout (D6). */
async function run(io: Io, args: readonly string[]): Promise<Ran> {
  try {
    const out = await io.process.run(['openspec', ...args], { cwd: await io.session.root(), timeoutMs: OPENSPEC_TIMEOUT_MS })
    return { exitCode: out.exitCode, stdout: out.stdout, output: `${out.stdout}\n${out.stderr}` }
  } catch (error) {
    return { exitCode: -1, stdout: '', output: `openspec did not run: ${error instanceof Error ? error.message : String(error)}` }
  }
}

async function json(io: Io, args: readonly string[]): Promise<CliResult<Record<string, unknown>>> {
  const ran = await run(io, args)
  const value = parse(ran.stdout)
  return ran.exitCode === 0 && isRecord(value) ? { ok: true, value } : fail(ran.output)
}

export async function listChanges(io: Io): Promise<CliResult<readonly ListedChange[]>> {
  const out = await json(io, ['list', '--json'])
  if (!out.ok) return out
  if (!Array.isArray(out.value.changes)) return fail('openspec list answered no changes array')
  return {
    ok: true,
    value: out.value.changes.filter(isRecord).flatMap(change => (typeof change.name === 'string'
      ? [{ name: change.name, completedTasks: Number(change.completedTasks ?? 0), totalTasks: Number(change.totalTasks ?? 0), status: String(change.status ?? '') }]
      : [])),
  }
}

function artifactOf(value: unknown): ArtifactState | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.outputPath !== 'string') return undefined
  const status = STATUSES.find(known => known === value.status) ?? 'blocked'
  return { id: value.id, status, path: value.outputPath, requires: stringArray(value.requires) ?? [] }
}

export async function changeStatus(io: Io, id: string): Promise<CliResult<CliStatus>> {
  if (!isPlanChangeName(id)) return invalidName(id)
  const out = await json(io, ['status', '--change', id, '--json'])
  if (!out.ok) return out
  const raw = Array.isArray(out.value.artifacts) ? out.value.artifacts : []
  const artifacts = raw.flatMap(item => { const artifact = artifactOf(item); return artifact === undefined ? [] : [artifact] })
  if (artifacts.length === 0 || artifacts.length !== raw.length) return fail('openspec status answered no readable artifacts')
  return { ok: true, value: { schema: String(out.value.schemaName ?? ''), artifacts, applyRequires: stringArray(out.value.applyRequires) ?? [] } }
}

export async function instructions(io: Io, id: string, artifact: string): Promise<CliResult<Instructions>> {
  if (!isPlanChangeName(id)) return invalidName(id)
  if (!ARTIFACT_ID.test(artifact)) return fail(`invalid artifact id: ${artifact}`)
  const ran = await run(io, ['instructions', artifact, '--change', id, '--json'])
  const value = parse(ran.stdout)
  if (ran.exitCode !== 0 || !isRecord(value) || typeof value.outputPath !== 'string') return fail(ran.output)
  const dependencies = (Array.isArray(value.dependencies) ? value.dependencies : []).filter(isRecord).flatMap(dep =>
    (typeof dep.id === 'string' && typeof dep.path === 'string' ? [{ id: dep.id, done: dep.done === true, path: dep.path }] : []))
  return { ok: true, value: { artifactId: String(value.artifactId ?? artifact), outputPath: value.outputPath, dependencies, raw: ran.stdout.trim() } }
}

const issuesText = (items: readonly Record<string, unknown>[], fallback: string): string => {
  const lines = items.flatMap(item => (Array.isArray(item.issues) ? item.issues : []).filter(isRecord).map(issue =>
    `${String(issue.level ?? issue.severity ?? 'ERROR')}: ${String(issue.path ?? '')} ${String(issue.message ?? '')}`.replace(/\s+/g, ' ').trim()))
  return lines.length > 0 ? lines.join('\n') : fallback.trim().slice(0, OUTPUT_MAX)
}

export async function validateChange(io: Io, id: string): Promise<CliResult<Validation>> {
  if (!isPlanChangeName(id)) return invalidName(id)
  const ran = await run(io, ['validate', id, '--strict', '--json'])
  const value = parse(ran.stdout)
  const items = isRecord(value) && Array.isArray(value.items) ? value.items.filter(isRecord) : undefined
  if (items === undefined) return fail(ran.output)
  const valid = ran.exitCode === 0 && items.length > 0 && items.every(item => item.valid === true)
  return { ok: true, value: { valid, output: valid ? 'valid' : issuesText(items, ran.output) } }
}

export async function newChange(io: Io, id: string, schema: string = SCHEMA): Promise<CliResult<true>> {
  if (!isPlanChangeName(id)) return invalidName(id)
  const ran = await run(io, ['new', 'change', id, '--schema', schema])
  return ran.exitCode === 0 ? { ok: true, value: true } : fail(ran.output)
}

/** The only writer of openspec/specs/ (D7, D14). */
export async function archiveCli(io: Io, id: string): Promise<CliResult<Record<string, unknown>>> {
  if (!isPlanChangeName(id)) return invalidName(id)
  return json(io, ['archive', id, '--yes', '--json'])
}
