import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import {
  ANSWERS, GREEN, RED, TWO_TASKS, agentOf, boot, callTool, lastAgent, scriptPtest, setupDemo, status, stopAgent, taskOf, zboard,
} from '../testing/zboard.ts'
import { argvIs, installWorld, worldIo } from '../testing/world.ts'

test('a task walks research → plan → tdd → code → review → done with no main-session action', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const dirty = setupDemo(w)
  scriptPtest(w, [RED, GREEN])
  await boot($)
  await zboard($, 'run demo')
  await stopAgent($, w, lastAgent(w), ANSWERS.research)
  await stopAgent($, w, lastAgent(w), ANSWERS.plan)
  dirty.set('tests/a.test.ts', 't1')
  await stopAgent($, w, lastAgent(w), ANSWERS.tdd)
  dirty.set('src/a.ts', 's1')
  await stopAgent($, w, lastAgent(w), ANSWERS.code)
  await stopAgent($, w, lastAgent(w), ANSWERS.approve)
  expect(w.spawns.map(spawn => spawn.subagentType)).toEqual([
    'zboard:researcher', 'zboard:planner', 'zboard:tdd', 'zboard:implementer', 'zboard:reviewer',
  ])
  expect((await taskOf($, '1.1')).status).toBe('done')
  expect(w.runs.filter(argv => argv[0] === 'ptest')).toEqual([['ptest', 'tests/a.test.ts'], ['ptest', 'tests/a.test.ts']])
})

test('the planner prompt contains the stored research artifact', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  await zboard($, 'run demo')
  await stopAgent($, w, lastAgent(w), ANSWERS.research)
  expect(w.spawns[1]?.prompt).toContain('### research')
  expect(w.spawns[1]?.prompt).toContain('the parser lives here')
})

test('pause lets in-flight phases finish and spawns nothing new until resumed', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w, TWO_TASKS)
  await boot($)
  await zboard($, 'run demo')
  await zboard($, 'pause')
  await stopAgent($, w, 'agent-1', ANSWERS.research)
  await stopAgent($, w, 'agent-2', ANSWERS.research)
  expect(w.spawns).toHaveLength(2)
  expect((await status($)).tasks.map(task => task.pending)).toEqual(['plan', 'plan'])
  await zboard($, 'run demo')
  expect(w.spawns.slice(2).map(spawn => spawn.subagentType)).toEqual(['zboard:planner', 'zboard:planner'])
})

test('a second SubagentStop for the same agent is ignored', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  await zboard($, 'run demo')
  await Promise.all([stopAgent($, w, 'agent-1', ANSWERS.research), stopAgent($, w, 'agent-1', ANSWERS.research)])
  await stopAgent($, w, 'agent-1', ANSWERS.research)
  expect(w.spawns.map(spawn => spawn.subagentType)).toEqual(['zboard:researcher', 'zboard:planner'])
  expect((await taskOf($, '1.1')).phases).toHaveLength(1)
})

test('a git failure for one task is recorded as a ModError and the other task continues', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w, TWO_TASKS)
  await boot($)
  await zboard($, 'run demo')
  w.rules.unshift({ match: argvIs('git', 'status'), once: true, answer: { exitCode: 128, stderr: 'fatal: index.lock exists\n' } })
  await stopAgent($, w, 'agent-1', ANSWERS.research)
  await stopAgent($, w, 'agent-2', ANSWERS.research)
  const board = await status($)
  expect(board.errors).toEqual([{ hook: 'orchestrator.complete', taskId: '1.1', message: 'git status failed: fatal: index.lock exists' }])
  expect(board.tasks.find(task => task.id === '1.2')?.phase).toBe('plan')
})

test('artifacts are stored, truncated past 50,000 characters, and readable with board_artifact', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  await zboard($, 'run demo')
  const huge = `${'x'.repeat(80_000)}\n${ANSWERS.research}`
  await stopAgent($, w, 'agent-1', huge)
  const read = await callTool($, 'board_artifact', { taskId: '1.1', phase: 'research' })
  expect(read.ok).toBe(true)
  const text = (read as { value: { text: string } }).value.text
  expect(text.length).toBeLessThanOrEqual(50_000)
  expect(text).toMatch(/\[zboard: truncated \d+ of \d+ characters\] transcript: \/t\/agent-1\.jsonl$/)
  expect(await agentOf($, 'agent-1')).toMatchObject({ transcriptPath: '/t/agent-1.jsonl', outcome: 'ok' })
})

test('a phase evaluation that throws needs a decision and frees its slot for the next task', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w, '## 1. Core\n\n- [ ] 1.1 A\n- [ ] 1.2 B\n- [ ] 1.3 C\n- [ ] 1.4 D\n')
  await boot($)
  await zboard($, 'run demo')
  expect(w.spawns).toHaveLength(3)
  w.rules.unshift({ match: argvIs('git', 'status'), once: true, answer: { exitCode: 128, stderr: 'fatal: index.lock exists\n' } })
  await stopAgent($, w, 'agent-1', ANSWERS.research)
  expect(await taskOf($, '1.1')).toMatchObject({
    status: 'needs_decision', statusReason: 'research evaluation failed: git status failed: fatal: index.lock exists',
  })
  expect(w.spawns.at(-1)?.prompt).toContain('Task 1.4: D')
  expect((await status($)).errors).toHaveLength(1)
})
