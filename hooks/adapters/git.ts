import type { Io } from '../runtime/io.ts'

import { unique } from '../domain/json.ts'

export type Baseline = Readonly<Record<string, string>>

export interface CommitRequest {
  readonly cwd: string
  readonly paths: readonly string[]
  readonly message: string
}

export type CommitResult = { readonly ok: true; readonly sha: string } | { readonly ok: false; readonly reason: string }

const GIT_TIMEOUT_MS = 60_000

const git = (io: Io, cwd: string, args: readonly string[]) =>
  io.process.run(['git', ...args], { cwd, timeoutMs: GIT_TIMEOUT_MS })

const firstLine = (text: string): string => text.split('\n').map(line => line.trim()).find(line => line !== '') ?? ''

export function parsePorcelainZ(out: string): { path: string; deleted: boolean }[] {
  const tokens = out.split('\0').filter(token => token !== '')
  const entries: { path: string; deleted: boolean }[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? ''
    const code = token.slice(0, 2)
    entries.push({ path: token.slice(3), deleted: code.includes('D') })
    if (code.startsWith('R') || code.startsWith('C')) index += 1
  }
  return entries
}

export async function snapshot(io: Io, cwd: string): Promise<Baseline> {
  const status = await git(io, cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  if (status.exitCode !== 0) throw new Error(`git status failed: ${firstLine(status.stderr)}`)
  const entries = parsePorcelainZ(status.stdout)
  const present = entries.filter(entry => !entry.deleted).map(entry => entry.path)
  const hashed = present.length === 0 ? '' : (await git(io, cwd, ['hash-object', '--', ...present])).stdout
  const hashes = hashed.split('\n').map(line => line.trim()).filter(line => line !== '')
  return Object.fromEntries([
    ...entries.filter(entry => entry.deleted).map(entry => [entry.path, 'deleted'] as const),
    ...present.map((path, index) => [path, hashes[index] ?? 'unhashed'] as const),
  ])
}

export const touchedBetween = (before: Baseline, after: Baseline): string[] =>
  unique([...Object.keys(before), ...Object.keys(after)]).filter(path => before[path] !== after[path]).sort()

export const commitMessage = (change: string, label: string, title: string): string => `feat(${change}): ${label} ${title}`

export async function commitTask(io: Io, req: CommitRequest): Promise<CommitResult> {
  if (req.paths.length === 0) return { ok: false, reason: 'no paths to commit' }
  const added = await git(io, req.cwd, ['add', '--', ...req.paths])
  if (added.exitCode !== 0) return { ok: false, reason: `git add failed: ${firstLine(added.stderr)}` }
  const committed = await git(io, req.cwd, ['commit', '--only', '-m', req.message, '--', ...req.paths])
  if (committed.exitCode !== 0) {
    return { ok: false, reason: `git commit failed: ${firstLine(committed.stderr) || firstLine(committed.stdout)}` }
  }
  const shown = await git(io, req.cwd, ['show', '--name-only', '--format=%H', 'HEAD'])
  const [sha = '', ...names] = shown.stdout.split('\n').map(line => line.trim()).filter(line => line !== '')
  const actual = [...names].sort()
  if (actual.join('\n') !== [...req.paths].sort().join('\n')) {
    return { ok: false, reason: `commit content differs from the task's files: ${actual.join(', ')}` }
  }
  return { ok: true, sha }
}
