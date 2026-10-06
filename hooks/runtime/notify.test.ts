import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { noticesBetween } from '../domain/notices.ts'
import { project } from '../domain/project.ts'
import { evs, loaded, parsed } from '../testing/factories.ts'
import { installWorld, worldIo } from '../testing/world.ts'
import { ANSWERS, GREEN, RED, boot, lastAgent, scriptPtest, setupDemo, stopAgent, zboard } from '../testing/zboard.ts'

const ready = project(evs([loaded(parsed('1.1'), parsed('1.2'))]))

test('routine progress produces no notice', () => {
  const after = project(evs([
    loaded(parsed('1.1'), parsed('1.2')),
    { type: 'PhaseStarted', taskId: '1.1', phase: 'tdd', attempt: 1, agentId: 'a', agentType: 'zboard:tdd', role: 'tdd', model: 'm', baseline: {} },
  ]))
  expect(noticesBetween(ready, after)).toEqual([])
})

test('a task that needs a decision produces one notice with label and reason', () => {
  const after = project(evs([
    loaded(parsed('1.1'), parsed('1.2')),
    { type: 'TaskStatusChanged', taskId: '1.1', from: 'running', to: 'needs_decision', reason: 'plan too narrow' },
  ]))
  expect(noticesBetween(ready, after)).toEqual(['zboard: task 1.1 "Task 1.1" needs a decision — plan too narrow'])
})

test('completing the change reminds about the integrated ptest --full gate; loading a finished change does not', () => {
  const done = project(evs([
    loaded(parsed('1.1'), parsed('1.2')),
    { type: 'TaskStatusChanged', taskId: '1.1', from: 'review', to: 'done' },
    { type: 'TaskStatusChanged', taskId: '1.2', from: 'review', to: 'done' },
  ]))
  const almost = project(evs([loaded(parsed('1.1'), parsed('1.2')), { type: 'TaskStatusChanged', taskId: '1.1', from: 'review', to: 'done' }]))
  expect(noticesBetween(almost, done)).toEqual([
    'zboard: change demo is complete (2/2 tasks done). The integrated `ptest --full` gate is still required before handoff.',
  ])
  expect(noticesBetween(project([]), done)).toEqual([])
})

test('an escalation reaches the main session and routine phases do not', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  await zboard($, 'run demo')
  await stopAgent($, lastAgent(w), ANSWERS.research)
  expect(w.toasts).toEqual([])
  await stopAgent($, lastAgent(w))
  await stopAgent($, lastAgent(w))
  expect(w.toasts).toEqual(['zboard: task 1.1 "Parse tasks" needs a decision — plan gate failed twice: plan: the agent ended without an artifact'])
})

test('finishing the last task sends the completion notice', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const dirty = setupDemo(w)
  scriptPtest(w, [RED, GREEN])
  await boot($)
  await zboard($, 'run demo')
  await stopAgent($, lastAgent(w), ANSWERS.research)
  await stopAgent($, lastAgent(w), ANSWERS.plan)
  dirty.set('tests/a.test.ts', 't1')
  await stopAgent($, lastAgent(w), ANSWERS.tdd)
  dirty.set('src/a.ts', 's1')
  await stopAgent($, lastAgent(w), ANSWERS.code)
  await stopAgent($, lastAgent(w), ANSWERS.approve)
  expect(w.toasts.at(-1)).toBe('zboard: change demo is complete (1/1 tasks done). The integrated `ptest --full` gate is still required before handoff.')
})
