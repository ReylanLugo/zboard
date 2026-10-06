import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { READY_FILES, scriptOpenspec, scriptRm, seedChange } from '../testing/openspec.ts'
import type { World } from '../testing/world.ts'
import { installWorld, worldIo } from '../testing/world.ts'
import { ANSWERS, boot, json, lastAgent, scriptGit, scriptRunner, setupDemo, stopAgent, taskOf, zboard } from '../testing/zboard.ts'
import type { Io } from './io.ts'
import { refreshChange } from './plan-catalog.ts'
import { installPlanJobs } from './plan-jobs.ts'
import { planStop } from './plan-runner.ts'
import { readPlan } from './plan-store.ts'
import { verifyChange } from './plan-verify.ts'

const CONFIG_PATH = '/repo/.zboard/config.json'
const PYTEST = ['uv', 'run', 'pytest']
const PYTEST_CONFIG = JSON.stringify({ testCommand: [...PYTEST, '{file}'], testTimeoutMs: 120_000 })
const PYTEST_RED = { exitCode: 1, stdout: 'FAILED tests/test_a.py::test_keeps_multiline - assert 1 == 2\n=== 1 failed, 2 passed in 0.2s ===\n' }
const PYTEST_GREEN = { exitCode: 0, stdout: '=== 3 passed in 0.2s ===\n' }

const PLAN = json({ approach: 'split lines', allowedFiles: ['src/a.py'], testFiles: ['tests/test_a.py'], testCases: ['keeps multiline'], edgeCases: [], risks: [] })
const TDD = json({ testFiles: ['tests/test_a.py'], newTests: ['test_keeps_multiline'] })

test('tdd and code gates run the configured test command instead of ptest', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const dirty = setupDemo(w)
  w.files.set(CONFIG_PATH, PYTEST_CONFIG)
  scriptRunner(w, PYTEST, [PYTEST_RED, PYTEST_GREEN])
  await boot($)
  await zboard($, 'run demo')
  await stopAgent($, lastAgent(w), ANSWERS.research)
  await stopAgent($, lastAgent(w), PLAN)
  dirty.set('tests/test_a.py', 't1')
  await stopAgent($, lastAgent(w), TDD)
  dirty.set('src/a.py', 's1')
  await stopAgent($, lastAgent(w), ANSWERS.code)
  await stopAgent($, lastAgent(w), ANSWERS.approve)
  expect((await taskOf($, '1.1')).status).toBe('done')
  const notice = 'zboard: change demo is complete (1/1 tasks done). The integrated full-suite gate is still required before handoff: run the project\'s full test suite.'
  expect(w.toasts.at(-1)).toBe(notice)
  const tddPrompt = w.spawns.find(spawn => spawn.subagentType === 'zboard:tdd')?.prompt ?? ''
  expect(tddPrompt).toContain('Run tests only as `uv run pytest <file>` from the repository root')
  expect(tddPrompt).not.toContain('ptest')
  const testRuns = w.runs.filter(argv => argv[0] === 'uv' || argv[0] === 'ptest')
  expect(testRuns).toEqual([[...PYTEST, 'tests/test_a.py'], [...PYTEST, 'tests/test_a.py']])
})

test('a custom runner that never finishes needs a decision naming the command', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const dirty = setupDemo(w)
  w.files.set(CONFIG_PATH, PYTEST_CONFIG)
  scriptRunner(w, PYTEST, [PYTEST_RED, { reject: 'timed out' }, { reject: 'timed out' }])
  await boot($)
  await zboard($, 'run demo')
  await stopAgent($, lastAgent(w), ANSWERS.research)
  await stopAgent($, lastAgent(w), PLAN)
  dirty.set('tests/test_a.py', 't1')
  await stopAgent($, lastAgent(w), TDD)
  dirty.set('src/a.py', 's1')
  await stopAgent($, lastAgent(w), ANSWERS.code)
  expect(await taskOf($, '1.1')).toMatchObject({
    status: 'needs_decision', statusReason: 'code gate failed: `uv run pytest <file>` incomplete twice: uv did not finish: zboard: $.process.run: timed out',
  })
})

test('an invalid testCommand keeps ptest and shows a config warning', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  w.files.set(CONFIG_PATH, '{"testCommand":"uv run pytest"}')
  await boot($)
  expect(await zboard($, 'config')).toContain('⚠ .zboard/config.json: testCommand must be a non-empty array')
})

const SPEC_TASKS = '## 1. Core\n\n- [x] 1.1 Export CSV writer [req: Export CSV]\n  Acceptance: a file\n'
const trueVerdict = { requirement: 'Export CSV', verdict: 'true', evidence: ['src/export.py:3'], tests: ['tests/test_export.py'] }

async function judged(w: World, output: { readonly exitCode: number; readonly stdout: string }): Promise<Io> {
  installPlanJobs()
  scriptOpenspec(w)
  scriptGit(w)
  scriptRm(w)
  seedChange(w, 'a', { ...READY_FILES, 'tasks.md': SPEC_TASKS })
  w.files.set(CONFIG_PATH, PYTEST_CONFIG)
  w.files.set('/repo/tests/test_export.py', 't')
  w.files.set('/repo/src/export.py', 's')
  scriptRunner(w, PYTEST, [output])
  const io = worldIo(w)
  await refreshChange(io, 'a')
  await verifyChange(io, { options: {} }, 'a')
  await planStop(io, { options: {} }, { agentId: lastAgent(w), answer: json({ findings: [trueVerdict] }) })
  return io
}

test('the judge runs cited tests through the configured command; a recognised pass proves true', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const io = await judged(w, PYTEST_GREEN)
  expect(w.runs).toContainEqual([...PYTEST, 'tests/test_export.py'])
  const finding = (await readPlan(io)).changes.a?.verify?.findings[0]
  expect(finding?.verdict).toBe('true')
  expect(finding?.evidence).toContain('uv run pytest tests/test_export.py: === 3 passed in 0.2s ===')
})

test('a custom runner whose output names no passed tests can never prove true', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const io = await judged(w, { exitCode: 0, stdout: 'all good\n' })
  expect(w.runs).toContainEqual([...PYTEST, 'tests/test_export.py'])
  expect((await readPlan(io)).changes.a?.verify?.findings[0]?.verdict).toBe('no_evidence')
})
