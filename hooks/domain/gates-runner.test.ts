import { expect, test } from 'claude-code/testing'

import type { TestRun } from './gates.ts'
import { greenGate, tddGate } from './gates.ts'

const PYTEST = 'uv run pytest <file>'
const custom = (kind: TestRun['kind'], endLine: string, failures: string[] = []): TestRun => ({ kind, endLine, failures, runner: PYTEST })
const tddAnswer = 'x\n```json\n{"testFiles":["tests/test_a.py"],"newTests":["test_new"]}\n```'

test('gate failures name a configured test command instead of ptest', () => {
  expect(greenGate(custom('incomplete', 'uv did not finish: timed out'), 'code')).toEqual({
    gate: 'fail', reason: '`uv run pytest <file>` incomplete twice: uv did not finish: timed out', terminal: true,
  })
  expect(greenGate(custom('unknown', 'refused test file "-x"'), 'code')).toEqual({
    gate: 'fail', reason: '`uv run pytest <file>` result unknown: refused test file "-x"', terminal: false,
  })
  expect(tddGate(custom('fail', '=== 1 failed ==='), tddAnswer)).toMatchObject({
    gate: 'fail', reason: 'tdd: `uv run pytest <file>` failed but no failing test could be identified',
  })
})
