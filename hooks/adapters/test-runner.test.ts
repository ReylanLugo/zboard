import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import type { Io } from '../runtime/io.ts'
import { argvIs, installWorld, worldIo } from '../testing/world.ts'
import { endLineOf, parseFailures, runFile, runScoped, testsExecuted } from './test-runner.ts'

const scoped = (files: string[]) => (($: Io) => runScoped($, files, '/repo'))

test('parseFailures reads pytest and vitest failure lines, ignoring colour codes', () => {
  const pytest = 'tests/a.py .F\n=== short test summary info ===\nFAILED tests/a.py::test_two - AssertionError: x\n'
  expect(parseFailures(pytest)).toEqual(['tests/a.py::test_two'])
  const vitest = ' \u001b[31mFAIL\u001b[39m  tests/a.test.ts > parser > keeps CRLF\n  × keeps CRLF 3ms\n'
  expect(parseFailures(vitest)).toEqual(['tests/a.test.ts > parser > keeps CRLF'])
})

test('parseFailures reads node:test spec and TAP failures, without the summary heading', () => {
  const spec = [
    '✖ greet returns Hello (0.51ms)',
    'ℹ tests 2',
    'ℹ fail 1',
    '',
    '✖ failing tests:',
    '',
    'test at greet.test.mjs:6:1',
    '✖ greet returns Hello (0.51ms)',
    '  Error [ERR_MODULE_NOT_FOUND]: Cannot find module',
  ].join('\n')
  expect(parseFailures(spec)).toEqual(['greet returns Hello'])
  expect(parseFailures('TAP version 13\nnot ok 1 - greet trims input\n  ---\n# fail 1\n')).toEqual(['greet trims input'])
})

test('testsExecuted reads node:test spec and TAP pass counts', () => {
  expect(testsExecuted('✔ a (1ms)\n✔ b (1ms)\nℹ tests 2\nℹ suites 0\nℹ pass 2\nℹ fail 0\n')).toBe(2)
  expect(testsExecuted('TAP version 13\nok 1 - a\n# tests 1\n# pass 1\n# fail 0\n')).toBe(1)
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

test('an exit 0 that ran no test is unknown, never a pass', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  w.rules.push({ match: argvIs('ptest', 'tests/none.py'), answer: { exitCode: 0, stderr: 'ptest: no changes vs main — nothing to test\n' } })
  w.rules.push({ match: argvIs('ptest', 'tests/zero.py'), answer: { exitCode: 0, stderr: 'ptest: demo · passed · 0 tests\n' } })
  w.rules.push({ match: argvIs('ptest', 'tests/unaffected.py'), answer: { exitCode: 0, stderr: 'changed: tests/unaffected.py → no tests affected\n' } })
  const io = worldIo(w)
  for (const file of ['tests/none.py', 'tests/zero.py', 'tests/unaffected.py']) expect((await runFile(io, file, '/repo')).kind).toBe('unknown')
})

test('testsExecuted reads the count from a passed end line', () => {
  expect(testsExecuted('ptest: demo · passed · 3 tests')).toBe(3)
  expect(testsExecuted('ptest: demo · passed · 1 test')).toBe(1)
  expect(testsExecuted('ptest: no changes vs main — nothing to test')).toBe(0)
})
