import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import type { Engine } from 'claude-code/testing'
import type { World } from '../testing/world.ts'
import { installWorld, worldIo } from '../testing/world.ts'
import {
  ANSWERS, GREEN, INCOMPLETE, RED, boot, json, lastAgent, scriptPtest, setupDemo, stopAgent, taskOf, zboard,
} from '../testing/zboard.ts'

async function toCode($: Engine, w: World, dirty: Map<string, string>): Promise<void> {
  await boot($)
  await zboard($, 'run demo')
  await stopAgent($, w, lastAgent(w), ANSWERS.research)
  await stopAgent($, w, lastAgent(w), ANSWERS.plan)
  dirty.set('tests/a.test.ts', 't1')
  await stopAgent($, w, lastAgent(w), ANSWERS.tdd)
}

async function toReview($: Engine, w: World, dirty: Map<string, string>): Promise<void> {
  await toCode($, w, dirty)
  dirty.set('src/a.ts', 's1')
  await stopAgent($, w, lastAgent(w), ANSWERS.code)
}

test('a changes verdict spawns a refactor, increments loop, then reviews again', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const dirty = setupDemo(w)
  scriptPtest(w, [RED, GREEN, GREEN])
  await toReview($, w, dirty)
  await stopAgent($, w, lastAgent(w), ANSWERS.changes)
  expect(w.spawns.at(-1)?.subagentType).toBe('zboard:refactorer')
  expect(w.spawns.at(-1)?.prompt).toContain('unclear name')
  dirty.set('src/a.ts', 's2')
  await stopAgent($, w, lastAgent(w), ANSWERS.refactor)
  expect(w.spawns.at(-1)?.subagentType).toBe('zboard:reviewer')
  expect((await taskOf($, '1.1')).loop).toBe(1)
})

test('at the loop cap a changes verdict needs a decision and spawns no refactor', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const dirty = setupDemo(w)
  scriptPtest(w, [RED, GREEN, GREEN, GREEN, GREEN])
  await toReview($, w, dirty)
  for (let round = 1; round <= 3; round += 1) {
    await stopAgent($, w, lastAgent(w), ANSWERS.changes)
    dirty.set('src/a.ts', `s${round + 1}`)
    await stopAgent($, w, lastAgent(w), ANSWERS.refactor)
  }
  const spawned = w.spawns.length
  await stopAgent($, w, lastAgent(w), ANSWERS.changes)
  expect(w.spawns).toHaveLength(spawned)
  expect(await taskOf($, '1.1')).toMatchObject({ status: 'needs_decision', loop: 3, statusReason: 'review loop cap reached (3) with changes requested' })
})

test('a first gate failure relaunches the phase with the reason; a second needs a decision', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const dirty = setupDemo(w)
  scriptPtest(w, [RED, RED, RED])
  await toCode($, w, dirty)
  dirty.set('src/a.ts', 's1')
  await stopAgent($, w, lastAgent(w), ANSWERS.code)
  expect(w.spawns.at(-1)).toMatchObject({ subagentType: 'zboard:implementer' })
  expect(w.spawns.at(-1)?.prompt).toContain('Previous gate failure — fix this first: code: tests fail: tests/a.test.ts > parser > keeps multiline')
  await stopAgent($, w, lastAgent(w), ANSWERS.code)
  expect(await taskOf($, '1.1')).toMatchObject({
    status: 'needs_decision', statusReason: 'code gate failed twice: code: tests fail: tests/a.test.ts > parser > keeps multiline',
  })
})

test('an agent that stops without an artifact is retried once, then escalated', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  await zboard($, 'run demo')
  await stopAgent($, w, lastAgent(w))
  expect(w.spawns.map(spawn => spawn.subagentType)).toEqual(['zboard:researcher', 'zboard:researcher'])
  await stopAgent($, w, lastAgent(w))
  expect(await taskOf($, '1.1')).toMatchObject({ status: 'needs_decision', statusReason: 'research gate failed twice: research: the agent ended without an artifact' })
})

test('a plan that authorizes a path outside the repository fails and never reaches tdd', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  await zboard($, 'run demo')
  await stopAgent($, w, lastAgent(w), ANSWERS.research)
  const outside = json({ approach: 'x', allowedFiles: ['../outside/secret.ts'], testFiles: ['tests/a.test.ts'], testCases: ['t'], edgeCases: [], risks: [] })
  await stopAgent($, w, lastAgent(w), outside)
  await stopAgent($, w, lastAgent(w), outside)
  expect(w.spawns.map(spawn => spawn.subagentType)).not.toContain('zboard:tdd')
  expect((await taskOf($, '1.1')).statusReason).toBe('plan gate failed twice: plan: paths outside the repository: ../outside/secret.ts')
})

test('tdd tests that pass at once fail the gate: RED was not observed', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  scriptPtest(w, [GREEN])
  await boot($)
  await zboard($, 'run demo')
  await stopAgent($, w, lastAgent(w), ANSWERS.research)
  await stopAgent($, w, lastAgent(w), ANSWERS.plan)
  await stopAgent($, w, lastAgent(w), ANSWERS.tdd)
  expect(w.spawns.at(-1)?.prompt).toContain('Previous gate failure — fix this first: tdd: tests passed; RED was not observed')
})

test('a reviewer approving in free text does not finish the task', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const dirty = setupDemo(w)
  scriptPtest(w, [RED, GREEN])
  await toReview($, w, dirty)
  await stopAgent($, w, lastAgent(w), 'Looks good, approve.')
  expect((await taskOf($, '1.1')).status).not.toBe('done')
  expect(w.spawns.at(-1)?.prompt).toContain('review: no valid ReviewVerdict JSON')
})

test('ptest incomplete twice in a row needs a decision that carries the end line', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const dirty = setupDemo(w)
  scriptPtest(w, [RED, INCOMPLETE, INCOMPLETE])
  await toCode($, w, dirty)
  dirty.set('src/a.ts', 's1')
  await stopAgent($, w, lastAgent(w), ANSWERS.code)
  expect(await taskOf($, '1.1')).toMatchObject({
    status: 'needs_decision', statusReason: 'code gate failed: ptest incomplete twice: ptest: incomplete (exit 70)',
  })
})

test('a read-only phase that changed files fails its gate', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const dirty = setupDemo(w)
  await boot($)
  await zboard($, 'run demo')
  dirty.set('src/sneaky.ts', 'x1')
  await stopAgent($, w, lastAgent(w), ANSWERS.research)
  expect(w.spawns.at(-1)?.prompt).toContain('research: changed files outside its scope: src/sneaky.ts')
})
