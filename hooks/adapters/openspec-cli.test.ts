import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { INSTRUCTIONS_TASKS_JSON, LIST_JSON, STATUS_JSON, VALIDATE_OK_JSON, VALIDATE_UNKNOWN_JSON, scriptOpenspec, validateInvalidJson, validateNoDeltaJson } from '../testing/openspec.ts'
import { argvIs, installWorld, worldIo } from '../testing/world.ts'
import { SCHEMA, archiveCli, changeStatus, instructions, listChanges, newChange, validateChange } from './openspec-cli.ts'

test('list parses the recorded output', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  w.rules.push({ match: argvIs('openspec', 'list'), answer: { stdout: LIST_JSON } })
  expect(await listChanges(worldIo(w))).toEqual({
    ok: true,
    value: [
      { name: 'zboard-changes-viewer', completedTasks: 0, totalTasks: 0, status: 'no-tasks' },
      { name: 'zboard-v1', completedTasks: 37, totalTasks: 37, status: 'complete' },
    ],
  })
  expect(w.runs).toEqual([['openspec', 'list', '--json']])
})

test('status keeps the CLI order, statuses, paths and apply requirements', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  w.rules.push({ match: argvIs('openspec', 'status'), answer: { stdout: STATUS_JSON } })
  const out = await changeStatus(worldIo(w), 'zboard-changes-viewer')
  if (!out.ok) throw new Error(out.output)
  expect(out.value.schema).toBe('superpowers-bridge')
  expect(out.value.applyRequires).toEqual(['plan'])
  expect(out.value.artifacts.map(a => [a.id, a.status])).toEqual([
    ['brainstorm', 'done'], ['proposal', 'done'], ['design', 'done'], ['specs', 'done'],
    ['tasks', 'ready'], ['plan', 'blocked'], ['verify', 'blocked'], ['retrospective', 'blocked'],
  ])
  expect(out.value.artifacts[3]).toEqual({ id: 'specs', status: 'done', path: 'specs/**/*.md', requires: ['proposal'] })
  expect(w.runs).toEqual([['openspec', 'status', '--change', 'zboard-changes-viewer', '--json']])
})

test('instructions keep the raw JSON for the prompt and parse the dependencies', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  w.rules.push({ match: argvIs('openspec', 'instructions'), answer: { stdout: INSTRUCTIONS_TASKS_JSON } })
  const out = await instructions(worldIo(w), 'zboard-changes-viewer', 'tasks')
  expect(out).toEqual({
    ok: true,
    value: { artifactId: 'tasks', outputPath: 'tasks.md', dependencies: [{ id: 'specs', done: true, path: 'specs/**/*.md' }], raw: INSTRUCTIONS_TASKS_JSON },
  })
  expect(w.runs).toEqual([['openspec', 'instructions', 'tasks', '--change', 'zboard-changes-viewer', '--json']])
})

test('validate: valid, invalid with its issues, and an unknown item as a failure', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  w.rules.push({ match: argvIs('openspec', 'validate', 'good'), answer: { stdout: VALIDATE_OK_JSON } })
  w.rules.push({ match: argvIs('openspec', 'validate', 'bad'), answer: { exitCode: 1, stdout: validateInvalidJson('bad', 'Requirement must have at least one scenario') } })
  w.rules.push({ match: argvIs('openspec', 'validate', 'gone'), answer: { exitCode: 1, stdout: VALIDATE_UNKNOWN_JSON } })
  w.rules.push({ match: argvIs('openspec', 'validate', 'early'), answer: { exitCode: 1, stdout: validateNoDeltaJson('early') } })
  const io = worldIo(w)
  expect(await validateChange(io, 'good')).toEqual({ ok: true, value: { valid: true, output: 'valid', onlyNoDelta: false } })
  expect(await validateChange(io, 'bad')).toEqual({ ok: true, value: { valid: false, output: 'ERROR: specs/x/spec.md Requirement must have at least one scenario', onlyNoDelta: false } })
  expect(await validateChange(io, 'early')).toEqual({ ok: true, value: { valid: false, output: 'ERROR: Change must have at least one delta. No deltas found', onlyNoDelta: true } })
  expect((await validateChange(io, 'gone')).ok).toBe(false)
  expect(w.runs[0]).toEqual(['openspec', 'validate', 'good', '--strict', '--json'])
})

test('a non-zero exit, prose output or a process that cannot start is a typed failure with the output', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  w.rules.push({ match: argvIs('openspec', 'list'), once: true, answer: { exitCode: 1, stderr: 'boom' } })
  w.rules.push({ match: argvIs('openspec', 'list'), once: true, answer: { stdout: 'not json' } })
  w.rules.push({ match: argvIs('openspec', 'list'), once: true, answer: { reject: 'spawn openspec ENOENT' } })
  const io = worldIo(w)
  expect(await listChanges(io)).toEqual({ ok: false, output: 'boom' })
  expect(await listChanges(io)).toEqual({ ok: false, output: 'not json' })
  expect(await listChanges(io)).toEqual({ ok: false, output: 'openspec did not run: spawn openspec ENOENT' })
})

test('invalid change ids never reach a process', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const io = worldIo(w)
  for (const id of ['../x', '--yes', '/etc', 'a/b']) {
    expect(await changeStatus(io, id)).toEqual({ ok: false, output: `invalid change name: ${id}` })
    expect((await validateChange(io, id)).ok).toBe(false)
    expect((await newChange(io, id)).ok).toBe(false)
    expect((await archiveCli(io, id)).ok).toBe(false)
    expect((await instructions(io, id, 'tasks')).ok).toBe(false)
  }
  expect((await instructions(io, 'a', '--json')).ok).toBe(false)
  expect(w.runs).toEqual([])
})

test('new change and archive run the exact argv; an archive conflict is a failure', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const script = scriptOpenspec(w)
  const io = worldIo(w)
  expect(await newChange(io, 'add-export', SCHEMA)).toEqual({ ok: true, value: true })
  expect(w.runs.at(-1)).toEqual(['openspec', 'new', 'change', 'add-export', '--schema', 'superpowers-bridge'])
  expect(await newChange(io, 'add-other')).toEqual({ ok: true, value: true })
  expect(w.runs.at(-1)).toEqual(['openspec', 'new', 'change', 'add-other'])
  expect((await archiveCli(io, 'add-export')).ok).toBe(true)
  expect(w.runs.at(-1)).toEqual(['openspec', 'archive', 'add-export', '--yes', '--json'])
  script.archive = { exitCode: 1, stderr: 'delta conflict: requirement "Export CSV" already exists' }
  expect(await archiveCli(io, 'add-export')).toEqual({ ok: false, output: 'delta conflict: requirement "Export CSV" already exists' })
})
