import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { fingerprintOf, fnv1a64 } from '../plan/hash.ts'
import { scriptRm, seedChange } from '../testing/openspec.ts'
import { installWorld, worldIo } from '../testing/world.ts'
import { archivedChanges, changeFiles, changeFingerprint, listFiles, matchGlob, readCurrent, removeFile } from './artifacts.ts'

test('FNV-1a 64 matches the reference vectors', () => {
  expect(fnv1a64('')).toBe('cbf29ce484222325')
  expect(fnv1a64('a')).toBe('af63dc4c8601ec8c')
  expect(fnv1a64('foobar')).toBe('85944171f73967e8')
})

test('the fingerprint ignores order and changes with any content', () => {
  const files = [{ path: 'b.md', text: '2' }, { path: 'a.md', text: '1' }]
  expect(fingerprintOf(files)).toBe(fingerprintOf([...files].reverse()))
  expect(fingerprintOf(files)).not.toBe(fingerprintOf([{ path: 'b.md', text: '2' }, { path: 'a.md', text: '1!' }]))
})

test('change files are listed recursively, sorted, without .openspec.yaml', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  seedChange(w, 'a', { 'proposal.md': 'p', 'specs/x/spec.md': 's', 'design.md': 'd' })
  const io = worldIo(w)
  expect(await listFiles(io, 'openspec/changes/a')).toEqual([
    'openspec/changes/a/.openspec.yaml', 'openspec/changes/a/design.md', 'openspec/changes/a/proposal.md', 'openspec/changes/a/specs/x/spec.md',
  ])
  expect((await changeFiles(io, 'a')).map(f => f.path)).toEqual(['openspec/changes/a/design.md', 'openspec/changes/a/proposal.md', 'openspec/changes/a/specs/x/spec.md'])
  const before = await changeFingerprint(io, 'a')
  w.files.set('/repo/openspec/changes/a/design.md', 'd2')
  expect(await changeFingerprint(io, 'a')).not.toBe(before)
})

test('an invalid id is refused before any file access', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  await expect(changeFiles(worldIo(w), '../../etc')).rejects.toThrow('invalid change name: ../../etc')
})

test('readCurrent answers null for missing files; removeFile runs rm from the root', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  scriptRm(w)
  seedChange(w, 'a', { 'proposal.md': 'p' })
  const io = worldIo(w)
  expect(await readCurrent(io, ['openspec/changes/a/proposal.md', 'openspec/changes/a/verify.md'])).toEqual({
    'openspec/changes/a/proposal.md': 'p', 'openspec/changes/a/verify.md': null,
  })
  await removeFile(io, 'openspec/changes/a/proposal.md')
  expect(w.runs).toEqual([['rm', '-f', '--', 'openspec/changes/a/proposal.md']])
  expect(w.files.has('/repo/openspec/changes/a/proposal.md')).toBe(false)
})

test('globs follow the CLI outputPath forms', () => {
  expect(matchGlob('openspec/changes/a/specs/**/*.md', 'openspec/changes/a/specs/export/spec.md')).toBe(true)
  expect(matchGlob('openspec/changes/a/specs/**/*.md', 'openspec/changes/a/specs/x.md')).toBe(true)
  expect(matchGlob('openspec/changes/a/specs/**/*.md', 'openspec/changes/a/specs/x.txt')).toBe(false)
  expect(matchGlob('openspec/changes/a/tasks.md', 'openspec/changes/a/tasks.md')).toBe(true)
  expect(matchGlob('openspec/changes/a/tasks.md', 'openspec/changes/a/tasksXmd')).toBe(false)
})

test('archived changes are the directories under openspec/changes/archive', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  w.files.set('/repo/openspec/changes/archive/2026-01-01-c/proposal.md', 'p')
  expect(await archivedChanges(worldIo(w))).toEqual(['2026-01-01-c'])
})
