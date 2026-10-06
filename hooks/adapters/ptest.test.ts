import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import type { Io } from '../runtime/io.ts'
import { argvIs, installWorld, worldIo } from '../testing/world.ts'
import { endLineOf, parseFailures, runScoped } from './ptest.ts'

const scoped = (files: string[]) => (($: Io) => runScoped($, files, '/repo'))

test('parseFailures reads pytest and vitest failure lines, ignoring colour codes', () => {
  const pytest = 'tests/a.py .F\n=== short test summary info ===\nFAILED tests/a.py::test_two - AssertionError: x\n'
  expect(parseFailures(pytest)).toEqual(['tests/a.py::test_two'])
  const vitest = ' \u001b[31mFAIL\u001b[39m  tests/a.test.ts > parser > keeps CRLF\n  × keeps CRLF 3ms\n'
  expect(parseFailures(vitest)).toEqual(['tests/a.test.ts > parser > keeps CRLF'])
})

test('endLineOf prefers the last ptest narration line on stderr', () => {
  expect(endLineOf('ptest: demo · pytest\nptest: demo · failed · 1 of 3 tests\n', 'x')).toBe('ptest: demo · failed · 1 of 3 tests')
  expect(endLineOf('', 'last stdout line\n')).toBe('last stdout line')
})

test('every file passing is a pass; argv is ptest <file> only', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  w.rules.push({ match: argvIs('ptest'), answer: { exitCode: 0, stderr: 'ptest: demo · passed · 2 tests\n' } })
  expect(await (scoped(['tests/a.py', 'tests/b.py']))(worldIo(w))).toEqual({ kind: 'pass', endLine: 'ptest: demo · passed · 2 tests', failures: [] })
  expect(w.runs).toEqual([['ptest', 'tests/a.py'], ['ptest', 'tests/b.py']])
})

test('exit 1 is a failure with parsed failing tests', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  w.rules.push({ match: argvIs('ptest'), answer: { exitCode: 1, stdout: 'FAILED tests/a.py::test_new - E\n', stderr: 'ptest: demo · failed · 1 test\n' } })
  expect(await (scoped(['tests/a.py']))(worldIo(w))).toEqual({ kind: 'fail', endLine: 'ptest: demo · failed · 1 test', failures: ['tests/a.py::test_new'] })
})

test('exit 70 twice in a row is incomplete and carries the end line', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  w.rules.push({ match: argvIs('ptest'), answer: { exitCode: 70, stderr: 'ptest: incomplete (exit 70)\n' } })
  expect(await (scoped(['tests/a.py']))(worldIo(w))).toEqual({ kind: 'incomplete', endLine: 'ptest: incomplete (exit 70)', failures: [] })
  expect(w.runs).toHaveLength(2)
})

test('one retry without code changes: 75 then 0 is a pass', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  w.rules.push({ match: argvIs('ptest'), once: true, answer: { exitCode: 75, stderr: 'ptest: queue unavailable\n' } })
  w.rules.push({ match: argvIs('ptest'), answer: { exitCode: 0, stderr: 'ptest: demo · passed · 1 test\n' } })
  expect(await (scoped(['tests/a.py']))(worldIo(w))).toMatchObject({ kind: 'pass' })
})

test('a timeout is never a pass', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  w.rules.push({ match: argvIs('ptest'), answer: { reject: 'command still running after 600000 ms' } })
  expect(await (scoped(['tests/a.py']))(worldIo(w))).toMatchObject({ kind: 'incomplete' })
})

test('an unexpected exit code is unknown, and no files is unknown', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  w.rules.push({ match: argvIs('ptest'), answer: { exitCode: 2, stderr: 'ptest: unknown command\n' } })
  expect(await ((async ($: Io) => [await runScoped($, ['t.py'], '/repo'), await runScoped($, [], '/repo')]))(worldIo(w))).toEqual([
    { kind: 'unknown', endLine: 'ptest: unknown command', failures: [] },
    { kind: 'unknown', endLine: 'no test files to run', failures: [] },
  ])
})
