import { expect, test } from 'claude-code/testing'

import type { TestRun } from './gates.ts'
import { greenGate, tddGate, tddTestFiles } from './gates.ts'

const tddAnswer = '```json\n{"testFiles":["tests/test_parse.py"],"newTests":["test_parse_multiline"]}\n```'
const run = (kind: TestRun['kind'], failures: string[] = [], endLine = 'ptest: demo · failed · 1 test'): TestRun => ({ kind, failures, endLine })

test('tdd gate fails when the tests pass immediately (RED not observed)', () => {
  expect(tddGate(run('pass'), tddAnswer)).toEqual({ gate: 'fail', reason: 'tdd: tests passed; RED was not observed', terminal: false })
})

test('tdd gate passes when every failure is a new test', () => {
  const outcome = tddGate(run('fail', ['tests/test_parse.py::test_parse_multiline']), tddAnswer)
  expect(outcome).toMatchObject({ gate: 'pass', newTests: ['test_parse_multiline'] })
})

test('tdd gate fails when a pre-existing test fails', () => {
  const outcome = tddGate(run('fail', ['tests/test_parse.py::test_parse_multiline', 'tests/test_parse.py::test_old']), tddAnswer)
  expect(outcome).toEqual({ gate: 'fail', reason: 'tdd: pre-existing tests fail: tests/test_parse.py::test_old', terminal: false })
})

test('tdd gate treats an unidentifiable failure as ambiguous', () => {
  expect(tddGate(run('fail', []), tddAnswer)).toMatchObject({ gate: 'fail', reason: 'tdd: ptest failed but no failing test could be identified' })
  expect(tddGate(run('fail', ['x']), 'no json')).toMatchObject({ reason: 'tdd: artifact lists no newTests' })
})

test('incomplete ptest is terminal and carries the end line; unknown is a plain failure', () => {
  expect(tddGate(run('incomplete', [], 'ptest: incomplete (exit 70)'), tddAnswer)).toEqual({
    gate: 'fail', reason: 'ptest incomplete twice: ptest: incomplete (exit 70)', terminal: true,
  })
  expect(greenGate(run('unknown', [], 'timed out'), 'code')).toEqual({ gate: 'fail', reason: 'ptest result unknown: timed out', terminal: false })
})

test('green gate passes only on a passing run', () => {
  expect(greenGate(run('pass', [], 'ptest: demo · passed · 3 tests'), 'code')).toEqual({ gate: 'pass', summary: 'GREEN: ptest: demo · passed · 3 tests' })
  expect(greenGate(run('fail', ['tests/a.test.ts > a > b']), 'refactor')).toMatchObject({ gate: 'fail', reason: 'refactor: tests fail: tests/a.test.ts > a > b' })
})

test('tddTestFiles keeps only files inside the repository', () => {
  expect(tddTestFiles('```json\n{"testFiles":["tests/a.py","../x.py"],"newTests":["t"]}\n```', '/repo')).toEqual(['tests/a.py'])
})
