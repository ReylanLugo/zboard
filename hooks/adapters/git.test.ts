import { expect, test } from 'claude-code/testing'

import type { Io } from '../runtime/io.ts'
import { argvIs, installWorld, worldIo } from '../testing/world.ts'
import { commitMessage, commitTask, parsePorcelainZ, snapshot, touchedBetween } from './git.ts'

const request = { cwd: '/repo', paths: ['src/a.ts', 'tests/a.test.ts'], message: commitMessage('zboard-v1', '2.1', 'Parse tasks') }

test('parsePorcelainZ handles modified, untracked, deleted and renamed entries', () => {
  const out = ' M src/a.ts\0?? new.ts\0 D gone.ts\0R  moved.ts\0old.ts\0'
  expect(parsePorcelainZ(out)).toEqual([
    { path: 'src/a.ts', deleted: false },
    { path: 'new.ts', deleted: false },
    { path: 'gone.ts', deleted: true },
    { path: 'moved.ts', deleted: false },
  ])
})

test('touchedBetween finds new, changed and reverted paths', () => {
  const before = { 'a.ts': 'h1', 'b.ts': 'h2', 'c.ts': 'h3' }
  const after = { 'a.ts': 'h1', 'b.ts': 'h9', 'd.ts': 'h4' }
  expect(touchedBetween(before, after)).toEqual(['b.ts', 'c.ts', 'd.ts'])
})

test('snapshot hashes present files and marks deletions', async ($, on) => {
  const w = installWorld(on)
  w.rules.push({ match: argvIs('git', 'status'), answer: { stdout: ' M src/a.ts\0 D gone.ts\0' } })
  w.rules.push({ match: argvIs('git', 'hash-object'), answer: { stdout: 'abc123\n' } })
  expect(await ((($: Io) => snapshot($, '/repo')))(worldIo(w))).toEqual({ 'gone.ts': 'deleted', 'src/a.ts': 'abc123' })
  expect(w.runs[1]).toEqual(['git', 'hash-object', '--', 'src/a.ts'])
})

test('commits exactly the task files with --only and never -A', async ($, on) => {
  const w = installWorld(on)
  w.rules.push({ match: argvIs('git', 'add'), answer: {} })
  w.rules.push({ match: argvIs('git', 'commit'), answer: {} })
  w.rules.push({ match: argvIs('git', 'show'), answer: { stdout: 'f00dfeed\n\nsrc/a.ts\ntests/a.test.ts\n' } })
  expect(await ((($: Io) => commitTask($, request)))(worldIo(w))).toEqual({ ok: true, sha: 'f00dfeed' })
  expect(w.runs).toEqual([
    ['git', 'add', '--', 'src/a.ts', 'tests/a.test.ts'],
    ['git', 'commit', '--only', '-m', 'feat(zboard-v1): 2.1 Parse tasks', '--', 'src/a.ts', 'tests/a.test.ts'],
    ['git', 'show', '--name-only', '--format=%H', 'HEAD'],
  ])
  expect(w.runs.flat()).not.toContain('-A')
})

test('a failing commit is reported', async ($, on) => {
  const w = installWorld(on)
  w.rules.push({ match: argvIs('git', 'add'), answer: {} })
  w.rules.push({ match: argvIs('git', 'commit'), answer: { exitCode: 1, stderr: 'error: pathspec did not match\n' } })
  expect(await ((($: Io) => commitTask($, request)))(worldIo(w))).toEqual({ ok: false, reason: 'git commit failed: error: pathspec did not match' })
})

test('a commit whose content differs from the task files is reported', async ($, on) => {
  const w = installWorld(on)
  w.rules.push({ match: argvIs('git', 'add'), answer: {} })
  w.rules.push({ match: argvIs('git', 'commit'), answer: {} })
  w.rules.push({ match: argvIs('git', 'show'), answer: { stdout: 'f00d\n\nsrc/a.ts\nsrc/unrelated.ts\ntests/a.test.ts\n' } })
  expect(await ((($: Io) => commitTask($, request)))(worldIo(w))).toEqual({ ok: false, reason: "commit content differs from the task's files: src/a.ts, src/unrelated.ts, tests/a.test.ts" })
})

test('snapshot fails when git hash-object fails part-way (a nested repository): unknown never counts as unchanged', async ($, on) => {
  const w = installWorld(on)
  w.rules.push({ match: argvIs('git', 'status'), answer: { stdout: '?? a.ts\0?? nested/\0?? z.ts\0' } })
  w.rules.push({ match: argvIs('git', 'hash-object'), answer: { exitCode: 128, stdout: 'abc123\n', stderr: "fatal: could not open 'nested/' for reading: Is a directory\n" } })
  await expect(snapshot(worldIo(w), '/repo')).rejects.toThrow("git hash-object failed: fatal: could not open 'nested/' for reading: Is a directory")
})

test('snapshot fails when git hash-object answers fewer hashes than paths', async ($, on) => {
  const w = installWorld(on)
  w.rules.push({ match: argvIs('git', 'status'), answer: { stdout: '?? a.ts\0?? b.ts\0' } })
  w.rules.push({ match: argvIs('git', 'hash-object'), answer: { stdout: 'abc123\n' } })
  await expect(snapshot(worldIo(w), '/repo')).rejects.toThrow('git hash-object answered 1 hash(es) for 2 path(s)')
})
