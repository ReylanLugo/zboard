import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { installWorld, worldIo } from '../testing/world.ts'
import { boot, seedEngram, zboard } from '../testing/zboard.ts'

const SOURCE = '/repo/odd/tasks/parser.md'
const ODD = [
  '# Parser rewrite', '## Objective', 'Parse tasks faster.', '## Problem', 'Slow.', '## Why', 'Lag.', '## Scope', 'Parser only.',
  '## Constraints', 'No deps.', '## Acceptance criteria', 'Fast.', '## Tasks',
  '- [ ] T1 — Measure. Route: inline.', '- [x] T2 — Add parser. Route: inline. Commit: `abc123`.', '- [ ] Tidy up later', '',
].join('\n')
const digestIn = (text: string): string => /--confirm ([0-9a-f]{8})/.exec(text)?.[1] ?? 'missing'

test('the preview writes nothing, lists unparsed lines and asks for confirmation', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  w.files.set(SOURCE, ODD)
  await boot($)
  const preview = await zboard($, 'import-odd parser')
  expect(preview).toContain('nothing written yet')
  expect(preview).toContain('Unparsed lines (not imported):\n  - [ ] Tidy up later')
  expect([...w.files.keys()].filter(path => path.includes('openspec/changes/parser'))).toEqual([])
})

test('confirming with the digest writes the change, keeps [x], stores history and leaves the source untouched', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  w.files.set(SOURCE, ODD)
  await boot($)
  const digest = digestIn(await zboard($, 'import-odd parser'))
  expect(await zboard($, `import-odd parser --confirm ${digest}`)).toBe('wrote openspec/changes/parser (4 files).')
  expect(w.files.get('/repo/openspec/changes/parser/tasks.md')).toContain('- [x] 1.2 Add parser')
  expect(w.files.get(SOURCE)).toBe(ODD)
  const history = w.saved.find(saved => saved.topic === 'zboard/repo/parser/odd-history')
  expect(history?.content).toContain('"label":"1.2","route":"inline","commit":"abc123"')
})

test('an existing change directory is refused and nothing is written', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  w.files.set(SOURCE, ODD)
  w.files.set('/repo/openspec/changes/parser/proposal.md', 'mine')
  await boot($)
  expect(await zboard($, 'import-odd parser')).toBe('openspec/changes/parser already exists; nothing was written.')
  expect(w.files.get('/repo/openspec/changes/parser/proposal.md')).toBe('mine')
})

test('a traversal feature name is rejected before any read or write', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  await boot($)
  expect(await zboard($, 'import-odd ../../etc')).toBe('invalid feature name "../../etc"')
  expect(w.files.size).toBe(0)
})

test('a newer Engram mirror wins over the local file', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  w.files.set(SOURCE, ODD)
  seedEngram(w, 'odd/parser/tasks', `Updated: 2026-10-04 12:00:00\n${ODD.replace('Add parser', 'Add streaming parser')}`)
  await boot($)
  const preview = await zboard($, 'import-odd parser')
  expect(preview).toContain('1.2 Add streaming parser')
  expect(preview).toContain('Source: Engram odd/parser/tasks')
})

test('a stale digest is refused and a fresh preview is shown', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  w.files.set(SOURCE, ODD)
  await boot($)
  const digest = digestIn(await zboard($, 'import-odd parser'))
  w.files.set(SOURCE, ODD.replace('Measure', 'Measure twice'))
  const answer = await zboard($, `import-odd parser --confirm ${digest}`)
  expect(answer).toStartWith(`the preview changed since digest ${digest}; nothing was written.`)
  expect(w.files.has('/repo/openspec/changes/parser/tasks.md')).toBe(false)
})
