import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import type { Io } from '../runtime/io.ts'
import type { EventBody } from '../domain/events.ts'
import { project } from '../domain/project.ts'
import type { Phase, Role } from '../domain/types.ts'
import { evs, loaded, parsed } from '../testing/factories.ts'
import { installWorld, worldIo } from '../testing/world.ts'
import { boot, setupDemo, zboard } from '../testing/zboard.ts'
import { guardDecision, placeInside } from './guard.ts'

const planned: EventBody = { type: 'PhaseCompleted', taskId: '1.1', phase: 'plan', attempt: 1, gate: 'pass', allowedFiles: ['src/allowed/a.ts'], testFiles: ['tests/a.test.ts'] }
const deny = (agentId: string): EventBody => ({ type: 'GuardDenied', taskId: '1.1', agentId, path: 'x' })
const boardIn = (phase: Phase, role: Role, extra: EventBody[] = []) => project(evs([
  loaded(parsed('1.1')),
  planned,
  { type: 'PhaseStarted', taskId: '1.1', phase, attempt: 1, agentId: 'a1', agentType: `zboard:${role}`, role, model: 'm', baseline: {} },
  ...extra,
]))

test('a review-phase edit is denied as read-only', () => {
  expect(guardDecision(boardIn('review', 'reviewer'), 'a1', 'src/allowed/a.ts', 'src/allowed/a.ts')).toEqual({
    kind: 'deny', reason: 'zboard: the review phase is read-only; src/allowed/a.ts was not changed.', events: [],
  })
})

test('an implementer write outside the allowed files is denied with the allowed list', () => {
  expect(guardDecision(boardIn('code', 'implementer'), 'a1', 'src/other.ts', 'src/other.ts')).toEqual({
    kind: 'deny',
    reason: "zboard: src/other.ts is outside this task's allowed files (src/allowed/a.ts, tests/a.test.ts).",
    events: [{ type: 'GuardDenied', taskId: '1.1', agentId: 'a1', path: 'src/other.ts' }],
  })
  expect(guardDecision(boardIn('code', 'implementer'), 'a1', 'src/allowed/a.ts', 'src/allowed/a.ts')).toEqual({ kind: 'pass' })
})

test('a traversal path is judged by where it lands', () => {
  const decision = guardDecision(boardIn('code', 'implementer'), 'a1', 'etc/passwd', 'src/allowed/../../etc/passwd')
  expect(decision.kind).toBe('deny')
})

test('the third deny in a phase asks for a decision: plan too narrow', () => {
  const decision = guardDecision(boardIn('code', 'implementer', [deny('a1'), deny('a1')]), 'a1', 'src/other.ts', 'src/other.ts')
  expect(decision.kind === 'deny' ? decision.events : []).toContainEqual({ type: 'TaskStatusChanged', taskId: '1.1', from: 'running', to: 'needs_decision', reason: 'plan too narrow' })
})

test('the tdd phase may write only test files; unknown agents pass', () => {
  expect(guardDecision(boardIn('tdd', 'tdd'), 'a1', 'src/allowed/a.ts', 'src/allowed/a.ts').kind).toBe('deny')
  expect(guardDecision(boardIn('tdd', 'tdd'), 'a1', 'tests/a.test.ts', 'tests/a.test.ts').kind).toBe('pass')
  expect(guardDecision(boardIn('code', 'implementer'), 'someone-else', 'anything', 'anything').kind).toBe('pass')
})

test('placeInside resolves real paths, allows new folders inside, and rejects symlink escapes', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  w.files.set('/repo/src/a.ts', 'a')
  w.files.set('/etc/passwd', 'root')
  w.links.set('/repo/link', '/etc')
  expect(await ((async ($: Io) => [
  await placeInside($, 'src/a.ts', '/repo'),
  await placeInside($, '/repo/src/new/dir/b.ts', '/repo'),
  await placeInside($, 'link/passwd', '/repo'),
  await placeInside($, '../outside.ts', '/repo'),
]))(worldIo(w))).toEqual(['src/a.ts', 'src/new/dir/b.ts', undefined, undefined])
})

test('a research agent editing a file is denied (spike: the kit forwards agentId)', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'edited', text: 'edited' }))
  await boot($)
  await zboard($, 'run demo')
  const out = await $.tool.call({ tool: 'Edit', file_path: '/repo/src/a.ts', old_string: 'a', new_string: 'b', agentId: 'agent-1' } as never)
  expect(out.deny).toBe('zboard: the research phase is read-only; /repo/src/a.ts was not changed.')
})
