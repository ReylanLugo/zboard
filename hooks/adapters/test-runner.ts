import type { Io } from '../runtime/io.ts'

import type { ProjectConfig } from '../domain/config.ts'
import { PROCESS_MAX_TIMEOUT_MS } from '../domain/config.ts'
import type { TestRun } from '../domain/gates.ts'
import { unique } from '../domain/json.ts'

export const PTEST_TIMEOUT_MS = 600_000
const RETRYABLE = new Set([70, 75, 124])
const ANSI = /\u001b\[[0-9;]*m/g
const FILE_PLACEHOLDER = '{file}'

/** How one test file runs: ptest (the default) or the project's `testCommand`. */
export type TestRunner =
  | { readonly kind: 'ptest' }
  | { readonly kind: 'custom'; readonly argv: readonly string[]; readonly timeoutMs: number }

export const PTEST_RUNNER: TestRunner = { kind: 'ptest' }

/** One file's result, with the number of tests its output reports as passed. */
export type FileRun = TestRun & { readonly executed: number }

type Attempt = Omit<FileRun, 'kind'> & { readonly kind: TestRun['kind'] | 'retryable' }

export function runnerOf(project: ProjectConfig): TestRunner {
  if (project.testCommand === undefined) return PTEST_RUNNER
  const timeoutMs = Math.min(project.testTimeoutMs ?? PTEST_TIMEOUT_MS, PROCESS_MAX_TIMEOUT_MS)
  return { kind: 'custom', argv: project.testCommand, timeoutMs }
}

/** The argv for one file: `{file}` is replaced where it appears, else the file is appended. */
export function commandFor(runner: TestRunner, file: string): string[] {
  if (runner.kind === 'ptest') return ['ptest', file]
  const placed = runner.argv.some(part => part.includes(FILE_PLACEHOLDER))
  return placed ? runner.argv.map(part => part.replaceAll(FILE_PLACEHOLDER, () => file)) : [...runner.argv, file]
}

const DISPLAY_FILE = '<file>'

/** The command as a person reads it, e.g. `uv run pytest <file>`; elements with whitespace are quoted. */
export function commandDisplay(runner: TestRunner, file: string = DISPLAY_FILE): string {
  return commandFor(runner, file).map(part => (/\s/.test(part) || part === '' ? JSON.stringify(part) : part)).join(' ')
}

/** A plain repository-relative path that no runner can read as an option. */
const isRunnableFile = (file: string): boolean =>
  file !== '' && !file.includes('\0') && !file.startsWith('-') && !file.startsWith('/') && !file.split('/').includes('..')

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

const PASSED_COUNT = /\bpassed\b.*?(\d+) tests?\b/
const RAN_NOTHING = /nothing to test|no changes|no tests affected/i

type Counter = (text: string) => number | undefined

const firstCount = (pattern: RegExp): Counter => text => {
  const count = pattern.exec(text)?.[1]
  return count === undefined ? undefined : Number(count)
}

const summedCount = (pattern: RegExp): Counter => text => {
  const counts = [...text.matchAll(pattern)].map(match => Number(match[1] ?? 0))
  return counts.length === 0 ? undefined : counts.reduce((sum, count) => sum + count, 0)
}

/** go test: each `ok <pkg>` line that ran tests counts as one; `[no test files]` packages count as none. */
const goPackages: Counter = text => {
  const ran = text.split('\n').filter(line => /^ok\s+\S+/.test(line) && !line.includes('[no tests to run]'))
  return ran.length === 0 ? undefined : ran.length
}

/** Known runners' passed counts, first match wins: ptest, pytest, vitest, jest, cargo, go. */
const COUNTERS: readonly Counter[] = [
  firstCount(PASSED_COUNT),
  firstCount(/^=+ [^\n]*?\b(\d+) passed\b[^\n]* =+$/m),
  firstCount(/^\s*Tests\s+(?:[^\n]*\|\s*)?(\d+) passed\b/m),
  firstCount(/^Tests:\s+(?:[^\n]*,\s*)?(\d+) passed\b/m),
  summedCount(/^test result: ok\. (\d+) passed\b/gm),
  goPackages,
]

/** Tests a run's output reports as passed; 0 when no known runner summary names any. */
export function testsExecuted(output: string): number {
  const clean = output.replace(ANSI, '')
  for (const counter of COUNTERS) {
    const count = counter(clean)
    if (count !== undefined) return count
  }
  return 0
}

/** An exit 0 whose end line says nothing ran (or 0 tests ran) proves nothing. */
const ranNothing = (endLine: string): boolean =>
  RAN_NOTHING.test(endLine) || (PASSED_COUNT.test(endLine) && testsExecuted(endLine) === 0)

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

async function attemptPtest(io: Io, file: string, cwd: string): Promise<Attempt> {
  try {
    const out = await io.process.run(['ptest', file], { cwd, timeoutMs: PTEST_TIMEOUT_MS })
    const endLine = endLineOf(out.stderr, out.stdout) || `ptest exit ${out.exitCode}`
    const executed = testsExecuted(endLine)
    if (out.exitCode === 0) return { kind: ranNothing(endLine) ? 'unknown' : 'pass', endLine, failures: [], executed }
    if (out.exitCode === 1) return { kind: 'fail', endLine, failures: parseFailures(out.stdout), executed }
    return { kind: RETRYABLE.has(out.exitCode) ? 'retryable' : 'unknown', endLine, failures: [], executed }
  } catch (error) {
    return { kind: 'retryable', endLine: `ptest did not finish: ${message(error)}`, failures: [], executed: 0 }
  }
}

type CustomRunner = Extract<TestRunner, { readonly kind: 'custom' }>

/** Any runner: exit 0 passes, any other exit fails, a run that times out or cannot start is retryable. */
async function attemptCustom(io: Io, runner: CustomRunner, file: string, cwd: string): Promise<Attempt> {
  const argv = commandFor(runner, file)
  try {
    const out = await io.process.run(argv, { cwd, timeoutMs: runner.timeoutMs })
    const output = `${out.stdout}\n${out.stderr}`
    const endLine = lastLine(out.stdout.replace(ANSI, '')) ?? lastLine(out.stderr.replace(ANSI, '')) ?? `${argv[0]} exit ${out.exitCode}`
    if (out.exitCode === 0) return { kind: 'pass', endLine, failures: [], executed: testsExecuted(output) }
    return { kind: 'fail', endLine, failures: parseFailures(output), executed: 0 }
  } catch (error) {
    return { kind: 'retryable', endLine: `${argv[0]} did not finish: ${message(error)}`, failures: [], executed: 0 }
  }
}

const attempt = (io: Io, runner: TestRunner, file: string, cwd: string): Promise<Attempt> =>
  runner.kind === 'ptest' ? attemptPtest(io, file, cwd) : attemptCustom(io, runner, file, cwd)

/** Runs one file, retrying once when the run could not finish; an unsafe file never runs. */
export async function runFile(io: Io, file: string, cwd: string, runner: TestRunner = PTEST_RUNNER): Promise<FileRun> {
  if (!isRunnableFile(file)) {
    return { kind: 'unknown', endLine: `refused test file ${JSON.stringify(file)}: not a plain repository-relative path`, failures: [], executed: 0 }
  }
  const first = await attempt(io, runner, file, cwd)
  const final = first.kind === 'retryable' ? await attempt(io, runner, file, cwd) : first
  return final.kind === 'retryable' ? { kind: 'incomplete', endLine: final.endLine, failures: [], executed: 0 } : { ...final, kind: final.kind }
}

const resultOf = (run: TestRun): TestRun => ({ kind: run.kind, endLine: run.endLine, failures: run.failures })

export async function runScoped(io: Io, files: readonly string[], cwd: string, runner: TestRunner = PTEST_RUNNER): Promise<TestRun> {
  if (files.length === 0) return { kind: 'unknown', endLine: 'no test files to run', failures: [] }
  const runs: TestRun[] = []
  for (const file of files) {
    const run = resultOf(await runFile(io, file, cwd, runner))
    if (run.kind === 'incomplete' || run.kind === 'unknown') return run
    runs.push(run)
  }
  const failed = runs.filter(run => run.kind === 'fail')
  if (failed.length > 0) {
    return { kind: 'fail', endLine: failed[0]?.endLine ?? '', failures: unique(failed.flatMap(run => run.failures)) }
  }
  return { kind: 'pass', endLine: runs.at(-1)?.endLine ?? '', failures: [] }
}
