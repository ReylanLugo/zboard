import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from './testing/timeouts.ts'

import { mountPane } from './testing/ui.ts'
import { argvIs, installWorld, worldIo } from './testing/world.ts'
import {
  ANSWERS, GREEN, RED, TASKS_PATH, TWO_TASKS, boot, callTool, json, scriptPtest, setupDemo, status, stopAgent, zboard,
} from './testing/zboard.ts'

const planFor = (file: string) => json({ approach: 'x', allowedFiles: [`src/${file}.ts`], testFiles: [`tests/${file}.test.ts`], testCases: ['keeps multiline'], edgeCases: [], risks: [] })
const tddFor = (file: string) => json({ testFiles: [`tests/${file}.test.ts`], newTests: ['keeps multiline'] })

test('two tasks run concurrently to done, each in its own commit, with one completion notice', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const dirty = setupDemo(w, TWO_TASKS)
  scriptPtest(w, [RED, RED, GREEN, GREEN])
  await boot($)
  await zboard($, 'run demo')
  await stopAgent($, 'agent-1', ANSWERS.research)
  await stopAgent($, 'agent-2', ANSWERS.research)
  await stopAgent($, 'agent-3', planFor('a'))
  await stopAgent($, 'agent-4', planFor('b'))
  dirty.set('tests/a.test.ts', 'ta')
  await stopAgent($, 'agent-5', tddFor('a'))
  dirty.set('tests/b.test.ts', 'tb')
  await stopAgent($, 'agent-6', tddFor('b'))
  dirty.set('src/a.ts', 'sa')
  await stopAgent($, 'agent-7', ANSWERS.code)
  dirty.set('src/b.ts', 'sb')
  await stopAgent($, 'agent-8', ANSWERS.code)
  await stopAgent($, 'agent-9', ANSWERS.approve)
  await stopAgent($, 'agent-10', ANSWERS.approve)
  expect(w.runs.filter(argv => argv[1] === 'commit')).toEqual([
    ['git', 'commit', '--only', '-m', 'feat(demo): 1.1 Parse tasks', '--', 'tests/a.test.ts', 'src/a.ts'],
    ['git', 'commit', '--only', '-m', 'feat(demo): 1.2 Flip lines', '--', 'tests/b.test.ts', 'src/b.ts'],
  ])
  expect(w.files.get(TASKS_PATH)).toBe('## 1. Core\n\n- [x] 1.1 Parse tasks\n- [x] 1.2 Flip lines\n')
  expect(w.toasts).toEqual(['zboard: change demo is complete (2/2 tasks done). The integrated `ptest --full` gate is still required before handoff.'])
  const ui = await mountPane($, 'terminal')
  expect((await ui.find({ key: 'header' }))?.text).toBe('zboard · demo ▓▓▓▓▓ 2/2 · 0 agents · 0 decisions · 0 tok [v] Kanban')
  await ui.unmount()
})

test('a hook failure for one task shows on the header and the other task carries on', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w, TWO_TASKS)
  await boot($)
  await zboard($, 'run demo')
  w.rules.unshift({ match: argvIs('git', 'status'), once: true, answer: { exitCode: 128, stderr: 'fatal: index.lock exists\n' } })
  await stopAgent($, 'agent-1', ANSWERS.research)
  await stopAgent($, 'agent-2', ANSWERS.research)
  const ui = await mountPane($, 'desktop')
  expect((await ui.find({ key: 'header' }))?.text).toContain('✖ 1 error')
  expect((await status($)).tasks.find(task => task.id === '1.2')?.phase).toBe('plan')
  await ui.unmount()
})

test('the read tools never append an event', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  await zboard($, 'run demo')
  await stopAgent($, 'agent-1', ANSWERS.research)
  const before = (await status($)).events
  await callTool($, 'board_task', { taskId: '1.1' })
  await callTool($, 'board_agent', { agentId: 'agent-1' })
  await callTool($, 'board_artifact', { taskId: '1.1', phase: 'research' })
  expect((await status($)).events).toBe(before)
})
