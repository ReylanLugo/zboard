import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import type { Engine } from 'claude-code/testing'
import type { World } from '../testing/world.ts'
import { argvIs, installWorld, worldIo } from '../testing/world.ts'
import {
  ANSWERS, GREEN, RED, TASKS_PATH, boot, lastAgent, scriptPtest, setupDemo, status, stopAgent, taskOf, zboard,
} from '../testing/zboard.ts'

async function approve($: Engine, w: World, dirty: Map<string, string>, edits = true): Promise<void> {
  scriptPtest(w, [RED, GREEN])
  await boot($)
  await zboard($, 'run demo')
  await stopAgent($, lastAgent(w), ANSWERS.research)
  await stopAgent($, lastAgent(w), ANSWERS.plan)
  if (edits) dirty.set('tests/a.test.ts', 't1')
  await stopAgent($, lastAgent(w), ANSWERS.tdd)
  if (edits) dirty.set('src/a.ts', 's1')
  await stopAgent($, lastAgent(w), ANSWERS.code)
  await stopAgent($, lastAgent(w), ANSWERS.approve)
}

test('an approved task is committed with only its files and its tasks.md line is flipped', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const dirty = setupDemo(w)
  await approve($, w, dirty)
  expect(w.runs).toContainEqual(['git', 'add', '--', 'tests/a.test.ts', 'src/a.ts'])
  expect(w.runs).toContainEqual(['git', 'commit', '--only', '-m', 'feat(demo): 1.1 Parse tasks', '--', 'tests/a.test.ts', 'src/a.ts'])
  expect(w.files.get(TASKS_PATH)).toBe('## 1. Core\n\n- [x] 1.1 Parse tasks\n')
  expect(await taskOf($, '1.1')).toMatchObject({ status: 'done', statusReason: 'committed c0ffee1' })
  expect((await status($)).running).toBe(false)
})

test('unrelated modified files in the working tree are not staged', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const dirty = setupDemo(w)
  dirty.set('notes/todo.md', 'n1')
  await approve($, w, dirty)
  expect(w.runs.filter(argv => argv[1] === 'add')).toEqual([['git', 'add', '--', 'tests/a.test.ts', 'src/a.ts']])
})

test('a failing commit leaves the checkbox unchecked and needs a decision', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const dirty = setupDemo(w)
  w.rules.unshift({ match: argvIs('git', 'commit'), answer: { exitCode: 1, stderr: 'error: hook rejected the commit\n' } })
  await approve($, w, dirty)
  expect(w.files.get(TASKS_PATH)).toBe('## 1. Core\n\n- [ ] 1.1 Parse tasks\n')
  expect(await taskOf($, '1.1')).toMatchObject({ status: 'needs_decision', statusReason: 'git commit failed: error: hook rejected the commit' })
})

test('a commit whose content differs from the task files is not flipped', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const dirty = setupDemo(w)
  w.rules.unshift({ match: argvIs('git', 'show'), answer: { stdout: 'c0ffee\n\nsrc/a.ts\nsrc/extra.ts\ntests/a.test.ts\n' } })
  await approve($, w, dirty)
  expect(w.files.get(TASKS_PATH)).toBe('## 1. Core\n\n- [ ] 1.1 Parse tasks\n')
  expect((await taskOf($, '1.1')).statusReason).toBe("commit content differs from the task's files: src/a.ts, src/extra.ts, tests/a.test.ts")
})

test('a tasks.md line edited after it was read is not written and needs a decision', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const dirty = setupDemo(w)
  scriptPtest(w, [RED, GREEN])
  await boot($)
  await zboard($, 'run demo')
  w.files.set(TASKS_PATH, '## 1. Core\n\n- [ ] 1.1 Parse tasks quickly\n')
  await stopAgent($, lastAgent(w), ANSWERS.research)
  await stopAgent($, lastAgent(w), ANSWERS.plan)
  dirty.set('tests/a.test.ts', 't1')
  await stopAgent($, lastAgent(w), ANSWERS.tdd)
  dirty.set('src/a.ts', 's1')
  await stopAgent($, lastAgent(w), ANSWERS.code)
  await stopAgent($, lastAgent(w), ANSWERS.approve)
  expect(w.files.get(TASKS_PATH)).toBe('## 1. Core\n\n- [ ] 1.1 Parse tasks quickly\n')
  expect((await taskOf($, '1.1')).statusReason).toBe('committed c0ffee1 but tasks.md was not updated: line for 1.1 changed since it was read')
})

test('a task that touched no files is not committed', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const dirty = setupDemo(w)
  await approve($, w, dirty, false)
  expect(w.runs.filter(argv => argv[1] === 'commit')).toEqual([])
  expect((await taskOf($, '1.1')).statusReason).toBe('nothing to commit: the task touched no files')
})

test('a file a failed attempt changed outside the scope is never committed: the close needs a decision', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const dirty = setupDemo(w)
  scriptPtest(w, [RED, GREEN])
  await boot($)
  await zboard($, 'run demo')
  await stopAgent($, lastAgent(w), ANSWERS.research)
  await stopAgent($, lastAgent(w), ANSWERS.plan)
  dirty.set('tests/a.test.ts', 't1')
  dirty.set('src/sneaky.ts', 'x1')
  await stopAgent($, lastAgent(w), ANSWERS.tdd)
  expect(w.spawns.at(-1)?.prompt).toContain('tdd: changed files outside its scope: src/sneaky.ts')
  await stopAgent($, lastAgent(w), ANSWERS.tdd)
  dirty.set('src/a.ts', 's1')
  await stopAgent($, lastAgent(w), ANSWERS.code)
  await stopAgent($, lastAgent(w), ANSWERS.approve)
  expect(w.runs.filter(argv => argv[1] === 'add' || argv[1] === 'commit')).toEqual([])
  expect(await taskOf($, '1.1')).toMatchObject({ status: 'needs_decision', statusReason: "not committed: touched files outside the task's scope: src/sneaky.ts" })
  expect(w.files.get(TASKS_PATH)).toBe('## 1. Core\n\n- [ ] 1.1 Parse tasks\n')
})
