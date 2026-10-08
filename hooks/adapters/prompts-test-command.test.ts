import { expect, test } from 'claude-code/testing'

import { newTask } from '../domain/types.ts'
import { SYSTEM_PROMPTS, phasePrompt } from './prompts.ts'
import { PTEST_RUNNER, commandDisplay } from './test-runner.ts'

const task = { ...newTask({ id: '2.1', changeId: 'demo', title: 'Parse tasks', source: 'openspec', section: '2. Parser' }), testFiles: ['tests/test_parse.py'] }
const input = { task, phase: 'tdd' as const, attempt: 1, artifacts: [], comments: [] }

test('the phase prompt names ptest <file> as the test command by default', () => {
  expect(phasePrompt(input)).toContain('Run tests only as `ptest <file>` from the repository root; never call a test runner directly.')
})

test('the phase prompt names the configured test command', () => {
  const prompt = phasePrompt({ ...input, testCommand: 'uv run pytest <file>' })
  expect(prompt).toContain('Run tests only as `uv run pytest <file>` from the repository root; never call a test runner directly.')
  expect(prompt).not.toContain('ptest')
})

test('system prompts defer to the test command named in the task prompt', () => {
  for (const prompt of Object.values(SYSTEM_PROMPTS)) {
    expect(prompt).not.toContain('ptest')
    expect(prompt).toContain('Run tests only with the test command named in your task prompt')
  }
})

test('system prompts forbid cloud and infrastructure CLIs', () => {
  for (const prompt of Object.values(SYSTEM_PROMPTS)) {
    expect(prompt).toContain('Never run cloud or infrastructure CLIs (gcloud, gsutil, bq, terraform')
    expect(prompt).toContain('work only on local files and the local test command')
  }
})

test('commandDisplay shows the argv with <file> or the given file, quoting elements with spaces', () => {
  expect(commandDisplay(PTEST_RUNNER)).toBe('ptest <file>')
  expect(commandDisplay({ kind: 'custom', argv: ['uv', 'run', 'pytest', '{file}', '-q'], timeoutMs: 1_000 })).toBe('uv run pytest <file> -q')
  expect(commandDisplay({ kind: 'custom', argv: ['npx', 'vitest', 'run'], timeoutMs: 1_000 }, 'tests/a.test.ts')).toBe('npx vitest run tests/a.test.ts')
  expect(commandDisplay({ kind: 'custom', argv: ['sh', '-c', 'make test'], timeoutMs: 1_000 })).toBe('sh -c "make test" <file>')
})
