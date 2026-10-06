import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { parseProjectConfig } from '../domain/config.ts'
import { argvIs, installWorld, worldIo } from '../testing/world.ts'
import type { TestRunner } from './test-runner.ts'
import { PTEST_RUNNER, commandFor, runFile, runScoped, runnerOf, testsExecuted } from './test-runner.ts'

const PYTEST: TestRunner = { kind: 'custom', argv: ['uv', 'run', 'pytest', '{file}', '-q'], timeoutMs: 120_000 }
const PYTEST_PASS = { exitCode: 0, stdout: 'tests/a.py ...\n============ 3 passed in 0.12s ============\n' }

test('runnerOf resolves ptest by default and a custom runner from a valid testCommand', () => {
  expect(runnerOf(parseProjectConfig(undefined))).toEqual(PTEST_RUNNER)
  expect(runnerOf(parseProjectConfig('{"testCommand":[]}'))).toEqual(PTEST_RUNNER)
  expect(runnerOf(parseProjectConfig('{"testCommand":["uv","run","pytest"]}'))).toEqual({ kind: 'custom', argv: ['uv', 'run', 'pytest'], timeoutMs: 600_000 })
  expect(runnerOf(parseProjectConfig('{"testCommand":["pytest"],"testTimeoutMs":5000}'))).toEqual({ kind: 'custom', argv: ['pytest'], timeoutMs: 5_000 })
})

test('runnerOf caps the timeout at the ten minutes a process may run', () => {
  expect(runnerOf(parseProjectConfig('{"testCommand":["pytest"],"testTimeoutMs":3600000}'))).toMatchObject({ timeoutMs: 600_000 })
})

test('{file} is replaced inside its element; without it the file is appended', () => {
  expect(commandFor(PYTEST, 'tests/a.py')).toEqual(['uv', 'run', 'pytest', 'tests/a.py', '-q'])
  expect(commandFor({ kind: 'custom', argv: ['node', '--test', './{file}'], timeoutMs: 1_000 }, 'tests/a.js')).toEqual(['node', '--test', './tests/a.js'])
  expect(commandFor({ kind: 'custom', argv: ['npx', 'vitest', 'run'], timeoutMs: 1_000 }, 'tests/a.test.ts')).toEqual(['npx', 'vitest', 'run', 'tests/a.test.ts'])
  expect(commandFor(PTEST_RUNNER, 'tests/a.py')).toEqual(['ptest', 'tests/a.py'])
})

test('a custom runner runs its argv with its timeout and exit 0 is a pass', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  w.rules.push({ match: argvIs('uv', 'run', 'pytest'), answer: PYTEST_PASS })
  const run = await runFile(worldIo(w), 'tests/a.py', '/repo', PYTEST)
  expect(run).toEqual({ kind: 'pass', endLine: '============ 3 passed in 0.12s ============', failures: [], executed: 3 })
  expect(w.runs).toEqual([['uv', 'run', 'pytest', 'tests/a.py', '-q']])
  expect(w.runOptions).toEqual([{ cwd: '/repo', timeoutMs: 120_000 }])
})

test('any non-zero exit of a custom runner is a failure with parsed failing tests, never retried', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  w.rules.push({ match: argvIs('uv', 'run', 'pytest', 'tests/a.py'), answer: { exitCode: 1, stdout: 'FAILED tests/a.py::test_new - E\n=== 1 failed in 0.1s ===\n' } })
  w.rules.push({ match: argvIs('uv', 'run', 'pytest', 'tests/b.py'), answer: { exitCode: 70, stderr: 'internal error\n' } })
  const io = worldIo(w)
  expect(await runFile(io, 'tests/a.py', '/repo', PYTEST)).toMatchObject({ kind: 'fail', failures: ['tests/a.py::test_new'], endLine: '=== 1 failed in 0.1s ===' })
  expect(await runFile(io, 'tests/b.py', '/repo', PYTEST)).toMatchObject({ kind: 'fail', failures: [], endLine: 'internal error' })
  expect(w.runs).toHaveLength(2)
})

test('a custom runner that times out twice is incomplete', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  w.rules.push({ match: argvIs('uv'), answer: { reject: 'command still running after 120000 ms' } })
  expect(await runScoped(worldIo(w), ['tests/a.py'], '/repo', PYTEST)).toEqual({
    kind: 'incomplete', endLine: 'uv did not finish: command still running after 120000 ms', failures: [],
  })
  expect(w.runs).toHaveLength(2)
})

test('a custom runner that cannot start once is retried and can pass', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  w.rules.push({ match: argvIs('uv'), once: true, answer: { reject: 'spawn uv ENOENT' } })
  w.rules.push({ match: argvIs('uv'), answer: PYTEST_PASS })
  expect(await runFile(worldIo(w), 'tests/a.py', '/repo', PYTEST)).toMatchObject({ kind: 'pass', executed: 3 })
  expect(w.runs).toHaveLength(2)
})

test('an option-like, absolute or escaping test file is refused before any run', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  w.rules.push({ match: () => true, answer: PYTEST_PASS })
  const io = worldIo(w)
  for (const file of ['-x', '--collect-only', '/etc/passwd', '../outside.py', 'tests/../../x.py', '']) {
    for (const runner of [PYTEST, PTEST_RUNNER]) {
      expect(await runFile(io, file, '/repo', runner)).toMatchObject({ kind: 'unknown', failures: [], executed: 0 })
    }
  }
  expect(w.runs).toEqual([])
})

test('an exit 0 with unrecognised output passes but reports no executed tests', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  w.rules.push({ match: argvIs('make'), answer: { exitCode: 0, stdout: 'all good\n' } })
  const run = await runFile(worldIo(w), 'tests/a.sh', '/repo', { kind: 'custom', argv: ['make', 'test', 'FILE={file}'], timeoutMs: 1_000 })
  expect(run).toEqual({ kind: 'pass', endLine: 'all good', failures: [], executed: 0 })
  expect(w.runs).toEqual([['make', 'test', 'FILE=tests/a.sh']])
})

test('the default ptest runner keeps its argv, timeout and executed count', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  w.rules.push({ match: argvIs('ptest'), answer: { exitCode: 0, stdout: 'Tests  9 passed (9)\n', stderr: 'ptest: demo · passed · 2 tests\n' } })
  expect(await runFile(worldIo(w), 'tests/a.test.ts', '/repo')).toEqual({ kind: 'pass', endLine: 'ptest: demo · passed · 2 tests', failures: [], executed: 2 })
  expect(w.runOptions).toEqual([{ cwd: '/repo', timeoutMs: 600_000 }])
})

test('testsExecuted reads the passed count of known runners from their output', () => {
  expect(testsExecuted('ptest: demo · passed · 3 tests')).toBe(3)
  expect(testsExecuted('tests/a.py ..\n\u001b[32m========= 1 failed, 2 passed, 1 skipped in 0.30s =========\u001b[0m\n')).toBe(2)
  expect(testsExecuted(' Test Files  1 passed (1)\n      Tests  4 passed (4)\n   Start at  10:00:00\n')).toBe(4)
  expect(testsExecuted(' Test Files  1 failed (1)\n      Tests  1 failed | 5 passed (6)\n')).toBe(5)
  expect(testsExecuted('Test Suites: 1 passed, 1 total\nTests:       1 failed, 6 passed, 7 total\n')).toBe(6)
  expect(testsExecuted('ok  \texample.com/a\t0.01s\nok  \texample.com/b\t(cached)\n')).toBe(2)
  expect(testsExecuted('?   \texample.com/c\t[no test files]\n')).toBe(0)
  expect(testsExecuted('ok  \texample.com/a\t0.01s [no tests to run]\n')).toBe(0)
  expect(testsExecuted('test result: ok. 7 passed; 0 failed; 0 ignored\n\ntest result: ok. 2 passed; 0 failed\n')).toBe(9)
  expect(testsExecuted('test result: FAILED. 3 passed; 1 failed\n')).toBe(0)
  expect(testsExecuted('all good\n')).toBe(0)
  expect(testsExecuted('')).toBe(0)
})
