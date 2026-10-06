import type { Io } from '../runtime/io.ts'

import { fingerprintOf } from '../plan/hash.ts'
import { changeDir, isPlanChangeName } from '../plan/types.ts'

export const ARCHIVE_DIR = 'openspec/changes/archive'
const IGNORED = new Set(['.openspec.yaml'])
const RM_TIMEOUT_MS = 10_000

export interface ChangeFile {
  readonly path: string
  readonly text: string
}

/** Repo-relative paths of every regular file under `dir`, sorted; links are never followed. */
export async function listFiles(io: Io, dir: string): Promise<string[]> {
  const entries = await io.fs.list(dir).catch(() => [])
  const nested = await Promise.all(entries.map(async entry => {
    if (entry.kind === 'dir') return listFiles(io, `${dir}/${entry.name}`)
    return entry.kind === 'file' ? [`${dir}/${entry.name}`] : []
  }))
  return nested.flat().sort()
}

export async function changeFiles(io: Io, id: string): Promise<ChangeFile[]> {
  if (!isPlanChangeName(id)) throw new Error(`invalid change name: ${id}`)
  const paths = (await listFiles(io, changeDir(id))).filter(path => !IGNORED.has(path.slice(path.lastIndexOf('/') + 1)))
  return Promise.all(paths.map(async path => ({ path, text: await io.fs.read(path) })))
}

export const changeFingerprint = async (io: Io, id: string): Promise<string> => fingerprintOf(await changeFiles(io, id))

export const readOptional = async (io: Io, path: string): Promise<string | null> =>
  ((await io.fs.exists(path)) ? io.fs.read(path) : null)

export async function readCurrent(io: Io, paths: readonly string[]): Promise<Record<string, string | null>> {
  return Object.fromEntries(await Promise.all(paths.map(async path => [path, await readOptional(io, path)] as const)))
}

export const writeText = (io: Io, path: string, text: string): Promise<void> => io.fs.write(path, text)

/** Undoes a file a reverted proposal created; callers pass only write-scope-checked paths. */
export async function removeFile(io: Io, path: string): Promise<void> {
  const out = await io.process.run(['rm', '-f', '--', path], { cwd: await io.session.root(), timeoutMs: RM_TIMEOUT_MS })
  if (out.exitCode !== 0) throw new Error(`rm ${path} failed: ${out.stderr.trim()}`)
}

const escapeRegExp = (text: string): string => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&')

/** `**\/` matches any directory depth, `*` any run within one segment (the CLI's outputPath forms). */
export function matchGlob(pattern: string, path: string): boolean {
  const source = pattern.split('**/').map(part => part.split('*').map(escapeRegExp).join('[^/]*')).join('(?:.*/)?')
  return new RegExp(`^${source}$`).test(path)
}

export async function archivedChanges(io: Io): Promise<string[]> {
  const entries = await io.fs.list(ARCHIVE_DIR).catch(() => [])
  return entries.filter(entry => entry.kind === 'dir').map(entry => entry.name).sort()
}
