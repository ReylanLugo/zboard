import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { installWorld, worldIo } from '../testing/world.ts'
import { appendPlan, isolatePlan, readPlan } from './plan-store.ts'

test('appendPlan records plan events and readPlan folds them', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const io = worldIo(w)
  const board = await appendPlan(io, [{ type: 'ChangeCreated', changeId: 'a' }])
  expect(board.changes.a?.created).toBe(true)
  expect((await readPlan(io)).order).toEqual(['a'])
})

test('isolatePlan records the failure on its change and returns the fallback', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const io = worldIo(w)
  const out = await isolatePlan(io, 'changes.docs', async () => { throw new Error('boom') }, 'fallback', 'a')
  expect(out).toBe('fallback')
  expect((await readPlan(io)).changes.a?.errors.map(e => [e.hook, e.message])).toEqual([['changes.docs', 'boom']])
})

test('fs.list answers the entries of a world directory', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  w.files.set('/repo/openspec/changes/a/proposal.md', 'p')
  w.files.set('/repo/openspec/changes/a/specs/x/spec.md', 's')
  const io = worldIo(w)
  expect((await io.fs.list('openspec/changes/a')).map(e => [e.name, e.kind])).toEqual([['proposal.md', 'file'], ['specs', 'dir']])
  await expect(io.fs.list('openspec/missing')).rejects.toThrow('ENOENT')
})

test('the viewer UI state starts with nothing selected', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  expect((await worldIo(w).state.ui.read()).changes).toEqual({ selected: null, tab: 'summary', artifact: null, composing: null, forecast: null, showRaw: false, initError: null })
})
