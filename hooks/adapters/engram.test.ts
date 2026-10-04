import { expect, test } from 'claude-code/testing'

import type { Io } from '../runtime/io.ts'
import { project } from '../domain/project.ts'
import { evs, loaded, parsed } from '../testing/factories.ts'
import { installWorld, worldIo } from '../testing/world.ts'
import {
  MAX_ARTIFACT_CHARS, createMirror, fetchTopic, indexTopic, parseIds, phaseTopic, taskTopic, truncateArtifact,
} from './engram.ts'

const board = project(evs([loaded(parsed('1.1'), parsed('1.2'))]))
const target = { project: 'repo', change: 'demo' }

test('topic keys follow the design', () => {
  expect(taskTopic('repo', 'demo', '2.1')).toBe('zboard/repo/demo/2.1')
  expect(phaseTopic('repo', 'demo', '2.1', 'plan', 2)).toBe('zboard/repo/demo/2.1/plan-2')
  expect(indexTopic('repo', 'demo')).toBe('zboard/repo/demo/index')
})

test('an 80,000-character artifact is cut under the cap and ends with the marker and transcript path', () => {
  const stored = truncateArtifact('x'.repeat(80_000), '/t/agent-1.jsonl')
  expect(stored.length).toBeLessThanOrEqual(MAX_ARTIFACT_CHARS - 200)
  expect(stored).toMatch(/\[zboard: truncated \d+ of 80000 characters\] transcript: \/t\/agent-1\.jsonl$/)
  expect(truncateArtifact('short')).toBe('short')
})

test('parseIds reads hash, ID and JSON spellings', () => {
  expect(parseIds('Found 2:\n#12 [x] a\n#7 [y] b')).toEqual([12, 7])
  expect(parseIds('ID: 33 — title')).toEqual([33])
  expect(parseIds('{"results":[{"id":4},{"id":5}]}')).toEqual([4, 5])
})

test('several marks within 10 s give a single upsert per task after the window', async ($, on) => {
  const w = installWorld(on)
  await ((async ($: Io) => {
  const m = createMirror()
  const due = async (): Promise<void> => { await m.flush($, target, board) }
  m.markDirty($, ['1.1'], due)
  m.markDirty($, ['1.1', '1.2'], due)
  return null
}))(worldIo(w))
  expect(w.saved).toHaveLength(0)
  await w.clock.advance(10_000)
  expect(w.saved.map(saved => saved.topic).sort()).toEqual(['zboard/repo/active', 'zboard/repo/demo/1.1', 'zboard/repo/demo/1.2', 'zboard/repo/demo/index'])
})

test('an immediate flush saves pending writes and cancels the timer', async ($, on) => {
  const w = installWorld(on)
  expect(await ((async ($: Io) => {
  const m = createMirror()
  m.markDirty($, ['1.1'], async () => { await m.flush($, target, board) })
  return m.flush($, target, board)
}))(worldIo(w))).toEqual({ ok: true, saved: 3 })
  const before = w.saved.length
  await w.clock.advance(10_000)
  expect(w.saved).toHaveLength(before)
})

test('identical content saved twice differs by rev and updatedAt', async ($, on) => {
  const w = installWorld(on)
  const [first, second] = (await ((async ($: Io) => {
  const m = createMirror()
  m.markDirty($, ['1.1'], async () => undefined)
  await m.flush($, target, board)
  const first = await fetchTopic($, 'zboard/repo/demo/1.1')
  m.markDirty($, ['1.1'], async () => undefined)
  await m.flush($, target, board)
  const second = await fetchTopic($, 'zboard/repo/demo/1.1')
  return [first?.text, second?.text]
}))(worldIo(w))) as [string, string]
  expect(JSON.parse(first).rev).not.toBe(JSON.parse(second).rev)
  expect(JSON.parse(second).task.id).toBe('1.1')
})

const shared = createMirror()

test('an Engram error keeps the writes pending and the next flush retries them', async ($, on) => {
  const w = installWorld(on)
  w.engram = 'error'
  expect(await ((async ($: Io) => {
  shared.markDirty($, ['1.1'], async () => undefined)
  return { result: await shared.flush($, target, board), pending: shared.hasPending() }
}))(worldIo(w))).toEqual({ result: { ok: false, saved: 0 }, pending: true })
  w.engram = 'up'
  expect(await ((async ($: Io) => {
  shared.markDirty($, ['1.1'], async () => undefined)
  return { result: await shared.flush($, target, board), pending: shared.hasPending() }
}))(worldIo(w))).toEqual({ result: { ok: true, saved: 3 }, pending: false })
  expect(w.saved.map(saved => saved.topic)).toContain('zboard/repo/demo/1.1')
})

test('a missing Engram tool marks pending without throwing', async ($, on) => {
  const w = installWorld(on)
  w.engram = 'missing'
  expect(await ((async ($: Io) => {
  const m = createMirror()
  m.markDirty($, ['1.1'], async () => undefined)
  return { result: await m.flush($, target, board), pending: m.hasPending(), fetched: (await fetchTopic($, 'zboard/repo/demo/1.1')) ?? null }
}))(worldIo(w))).toEqual({ result: { ok: false, saved: 0 }, pending: true, fetched: null })
})
