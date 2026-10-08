import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { groupOf, isDone } from '../plan/lifecycle.ts'
import { DEFAULT_SCHEMA, READY_FILES, READY_TASKS, scriptOpenspec, seedChange } from '../testing/openspec.ts'
import { argvIs, installWorld, worldIo } from '../testing/world.ts'
import { checkOpenChange, createChange, refreshChange, refreshChanges } from './plan-catalog.ts'
import { appendPlan, readPlan } from './plan-store.ts'

const DESIGN = '/repo/openspec/changes/a/design.md'
const validations = (runs: readonly string[][]) => runs.filter(argv => argv[1] === 'validate').length

test('the list groups changes and shows stage and progress', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  scriptOpenspec(w)
  seedChange(w, 'a', READY_FILES)
  seedChange(w, 'b', { 'brainstorm.md': '# Brainstorm\n' })
  w.files.set('/repo/openspec/changes/archive/2026-01-01-c/proposal.md', 'p')
  const board = await refreshChanges(worldIo(w))
  const view = board.order.map(id => { const rec = board.changes[id]; return rec === undefined ? [] : [id, groupOf(rec), rec.stage, rec.tasks.length] })
  expect(view).toEqual([['a', 'active', 'ready', 1], ['b', 'drafts', 'authoring', 0], ['2026-01-01-c', 'archived', 'archived', 0]])
})

test('a failing CLI is shown and no change is invented', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  scriptOpenspec(w, { list: { exitCode: 1, stderr: 'openspec: not an OpenSpec repository' } })
  const board = await refreshChanges(worldIo(w))
  expect(board).toMatchObject({ listError: 'openspec: not an OpenSpec repository', order: [] })
})

test('one broken change shows its error and the others still list', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  w.rules.push({ match: argvIs('openspec', 'status', '--change', 'broken'), answer: { exitCode: 1, stderr: 'boom' } })
  scriptOpenspec(w)
  seedChange(w, 'broken', { 'brainstorm.md': 'b' })
  seedChange(w, 'a', READY_FILES)
  const board = await refreshChanges(worldIo(w))
  expect(board.changes.broken?.listError).toBe('boom')
  expect(board.changes.a?.stage).toBe('ready')
})

test('readiness is computed once per fingerprint and an uncovered new task drops ready to authoring', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  scriptOpenspec(w)
  seedChange(w, 'a', READY_FILES)
  const io = worldIo(w)
  await refreshChange(io, 'a')
  await refreshChange(io, 'a')
  expect(validations(w.runs)).toBe(1)
  w.files.set('/repo/openspec/changes/a/tasks.md', `${READY_TASKS}- [ ] 1.2 Polish the output\n  Acceptance: x\n`)
  const board = await refreshChange(io, 'a')
  expect(validations(w.runs)).toBe(2)
  expect(board.changes.a?.readiness.find(check => check.id === 'coverage')).toEqual({ id: 'coverage', ok: false, detail: '1.2 names no requirement' })
  expect(board.changes.a?.stage).toBe('authoring')
})

test('an external edit of the open change is picked up by the poll', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  scriptOpenspec(w)
  seedChange(w, 'a', READY_FILES)
  const io = worldIo(w)
  await refreshChange(io, 'a')
  await io.state.ui.update(ui => ({ ...ui, changes: { ...ui.changes, selected: 'a' } }))
  const before = (await readPlan(io)).changes.a?.fingerprint
  w.files.set(DESIGN, '## Context\n\nEdited in an editor.\n')
  await checkOpenChange(io)
  expect((await readPlan(io)).changes.a?.fingerprint).not.toBe(before)
  expect(validations(w.runs)).toBe(2)
})

test('a pending proposal whose file changed on disk is marked stale', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  scriptOpenspec(w)
  seedChange(w, 'a', READY_FILES)
  const io = worldIo(w)
  await refreshChange(io, 'a')
  await appendPlan(io, [{ type: 'ProposalReady', changeId: 'a', proposal: {
    id: 'p1', artifact: 'design', reason: 'r', status: 'pending', source: { kind: 'draft', artifact: 'design' },
    files: [{ path: 'openspec/changes/a/design.md', before: READY_FILES['design.md'] ?? '', after: 'new\n' }],
  } }])
  w.files.set(DESIGN, 'edited\n')
  expect((await refreshChange(io, 'a')).changes.a?.proposal?.status).toBe('stale')
})

test('a running change whose tasks are all checked records ExecutionFinished', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  scriptOpenspec(w)
  seedChange(w, 'a', READY_FILES)
  const io = worldIo(w)
  await appendPlan(io, [{ type: 'RunStarted', changeId: 'a' }])
  w.files.set('/repo/openspec/changes/a/tasks.md', READY_TASKS.replace('- [ ]', '- [x]'))
  const rec = (await refreshChange(io, 'a')).changes.a
  expect(rec).toMatchObject({ executionFinished: true, stage: 'verifying' })
})

test('creating a change validates the id, refuses an existing one and records it as a draft', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  scriptOpenspec(w)
  const io = worldIo(w)
  expect(await createChange(io, '../../etc')).toBe('zboard: invalid change name: ../../etc')
  expect(await createChange(io, '--yes')).toBe('zboard: invalid change name: --yes')
  expect(w.runs).toEqual([])
  expect(await createChange(io, 'add-export')).toBe('zboard: created add-export')
  expect(w.runs.filter(argv => argv[1] === 'new')).toEqual([['openspec', 'new', 'change', 'add-export', '--schema', 'superpowers-bridge']])
  const rec = (await readPlan(io)).changes['add-export']
  expect(rec).toMatchObject({ created: true, stage: 'draft' })
  expect(rec === undefined ? '' : groupOf(rec)).toBe('drafts')
  expect(rec === undefined ? true : isDone(rec, 'brainstorm')).toBe(false)
  const runs = w.runs.length
  expect(await createChange(io, 'add-export')).toBe('zboard: change add-export already exists')
  expect(w.runs).toHaveLength(runs)
})

test('without the superpowers-bridge schema a new change uses the project default', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  scriptOpenspec(w, { schemas: [DEFAULT_SCHEMA] })
  const io = worldIo(w)
  expect(await createChange(io, 'add-export')).toBe('zboard: created add-export')
  expect(w.runs.filter(argv => argv[1] === 'new')).toEqual([['openspec', 'new', 'change', 'add-export']])
  expect((await readPlan(io)).changes['add-export']?.status?.schema).toBe(DEFAULT_SCHEMA)
})

test('a failing schemas call falls back to the project default schema', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  w.rules.push({ match: argvIs('openspec', 'schemas'), answer: { exitCode: 1, stderr: 'unknown command schemas' } })
  scriptOpenspec(w)
  expect(await createChange(worldIo(w), 'add-export')).toBe('zboard: created add-export')
  expect(w.runs.filter(argv => argv[1] === 'new')).toEqual([['openspec', 'new', 'change', 'add-export']])
})
