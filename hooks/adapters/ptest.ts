import type { Io } from '../runtime/io.ts'

import type { TestRun } from '../domain/gates.ts'
import { unique } from '../domain/json.ts'

export const PTEST_TIMEOUT_MS = 600_000
const RETRYABLE = new Set([70, 75, 124])
const ANSI = /\u001b\[[0-9;]*m/g

type Attempt = { readonly kind: TestRun['kind'] | 'retryable'; readonly endLine: string; readonly failures: readonly string[] }

const lastLine = (text: string): string | undefined =>
  text.split('\n').map(line => line.trim()).filter(line => line !== '').at(-1)

export function endLineOf(stderr: string, stdout: string): string {
  const narrated = stderr.split('\n').map(line => line.trim()).filter(line => line.startsWith('ptest'))
  return narrated.at(-1) ?? lastLine(stderr) ?? lastLine(stdout) ?? ''
}

export function parseFailures(stdout: string): string[] {
  const clean = stdout.replace(ANSI, '')
  const pytest = [...clean.matchAll(/^FAILED (\S+)/gm)].map(match => match[1] ?? '')
  const vitest = [...clean.matchAll(/^\s*FAIL\s+(\S.*? > .+?)\s*$/gm)].map(match => match[1] ?? '')
  return unique([...pytest, ...vitest].filter(name => name !== ''))
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

async function attempt(io: Io, file: string, cwd: string): Promise<Attempt> {
  try {
    const out = await io.process.run(['ptest', file], { cwd, timeoutMs: PTEST_TIMEOUT_MS })
    const endLine = endLineOf(out.stderr, out.stdout) || `ptest exit ${out.exitCode}`
    if (out.exitCode === 0) return { kind: 'pass', endLine, failures: [] }
    if (out.exitCode === 1) return { kind: 'fail', endLine, failures: parseFailures(out.stdout) }
    return { kind: RETRYABLE.has(out.exitCode) ? 'retryable' : 'unknown', endLine, failures: [] }
  } catch (error) {
    return { kind: 'retryable', endLine: `ptest did not finish: ${message(error)}`, failures: [] }
  }
}

export async function runFile(io: Io, file: string, cwd: string): Promise<TestRun> {
  const first = await attempt(io, file, cwd)
  const final = first.kind === 'retryable' ? await attempt(io, file, cwd) : first
  return final.kind === 'retryable' ? { kind: 'incomplete', endLine: final.endLine, failures: [] } : { ...final, kind: final.kind }
}

export async function runScoped(io: Io, files: readonly string[], cwd: string): Promise<TestRun> {
  if (files.length === 0) return { kind: 'unknown', endLine: 'no test files to run', failures: [] }
  const runs: TestRun[] = []
  for (const file of files) {
    const run = await runFile(io, file, cwd)
    if (run.kind === 'incomplete' || run.kind === 'unknown') return run
    runs.push(run)
  }
  const failed = runs.filter(run => run.kind === 'fail')
  if (failed.length > 0) {
    return { kind: 'fail', endLine: failed[0]?.endLine ?? '', failures: unique(failed.flatMap(run => run.failures)) }
  }
  return { kind: 'pass', endLine: runs.at(-1)?.endLine ?? '', failures: [] }
}
