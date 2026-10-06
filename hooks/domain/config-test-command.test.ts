import { expect, test } from 'claude-code/testing'

import { configWarnings, parseProjectConfig } from './config.ts'

const COMMAND_WARNING = '.zboard/config.json: testCommand must be a non-empty array of non-empty strings (at most 32, each at most 512 characters); using ptest'
const TIMEOUT_WARNING = '.zboard/config.json: testTimeoutMs must be an integer from 1000 to 3600000; using ptest'

const parsed = (value: Record<string, unknown>) => parseProjectConfig(JSON.stringify(value))

test('a valid testCommand and testTimeoutMs are kept without warnings', () => {
  expect(parsed({ testCommand: ['uv', 'run', 'pytest', '{file}'], testTimeoutMs: 120_000 })).toEqual({
    layers: {}, testCommand: ['uv', 'run', 'pytest', '{file}'], testTimeoutMs: 120_000, warnings: [],
  })
  expect(parsed({ testCommand: ['npx', 'vitest', 'run'] })).toEqual({ layers: {}, testCommand: ['npx', 'vitest', 'run'], warnings: [] })
})

test('the timeout bounds are inclusive', () => {
  expect(parsed({ testCommand: ['pytest'], testTimeoutMs: 1_000 }).testTimeoutMs).toBe(1_000)
  expect(parsed({ testCommand: ['pytest'], testTimeoutMs: 3_600_000 }).testTimeoutMs).toBe(3_600_000)
})

test('an invalid testCommand is dropped with a warning, so ptest stays in use', () => {
  const invalid: unknown[] = [
    'uv run pytest', [], ['uv', ''], [1], ['uv', null],
    Array.from({ length: 33 }, () => 'x'), ['uv', 'x'.repeat(513)],
  ]
  for (const testCommand of invalid) {
    const config = parsed({ testCommand, testTimeoutMs: 60_000 })
    expect(config.testCommand).toBeUndefined()
    expect(config.testTimeoutMs).toBeUndefined()
    expect(config.warnings).toEqual([COMMAND_WARNING])
  }
  expect(parsed({ testCommand: Array.from({ length: 32 }, () => 'x'.repeat(512)) }).warnings).toEqual([])
})

test('an invalid testTimeoutMs drops the test settings with a warning, so ptest stays in use', () => {
  for (const testTimeoutMs of [999, 3_600_001, 1_500.5, '60000', null]) {
    const config = parsed({ testCommand: ['pytest'], testTimeoutMs })
    expect(config.testCommand).toBeUndefined()
    expect(config.testTimeoutMs).toBeUndefined()
    expect(config.warnings).toEqual([TIMEOUT_WARNING])
  }
})

test('testTimeoutMs without testCommand is ignored with a warning', () => {
  expect(parsed({ testTimeoutMs: 60_000 })).toEqual({ layers: {}, warnings: ['.zboard/config.json: testTimeoutMs is ignored without testCommand'] })
})

test('configWarnings surfaces test command warnings for the board header', () => {
  expect(configWarnings(parsed({ testCommand: [] }), {})).toEqual([COMMAND_WARNING])
})
