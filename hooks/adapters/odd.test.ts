import { expect, test } from 'claude-code/testing'

import { digestOf, generateChange, isFeatureName, parseOdd, previewText } from './odd.ts'

const ODD = [
  '# Parser rewrite',
  '',
  '## Objective',
  'Parse tasks faster.',
  '## Problem',
  'The parser is slow.',
  '## Why',
  'Boards lag.',
  '## Scope',
  'Only the parser.',
  '## Constraints',
  'No new dependencies.',
  '## Acceptance criteria',
  '- 10k lines under 50 ms',
  '## Tasks',
  '- [ ] T1 — Measure the baseline. Route: inline.',
  '- [x] T2 — Add parser. Route: inline. Commit: `abc123`.',
  '- [ ] Tidy up later',
  '',
].join('\n')

test('feature names are filename-safe identifiers', () => {
  expect(isFeatureName('parser-rewrite')).toBe(true)
  expect(isFeatureName('../../etc')).toBe(false)
  expect(isFeatureName('a b')).toBe(false)
})

test('parses tasks with route and commit, and keeps unparsed lines', () => {
  const doc = parseOdd(ODD)
  expect(doc.title).toBe('Parser rewrite')
  expect(doc.tasks).toEqual([
    { n: 1, done: false, title: 'Measure the baseline', route: 'inline' },
    { n: 2, done: true, title: 'Add parser', route: 'inline', commit: 'abc123' },
  ])
  expect(doc.unparsed).toEqual(['- [ ] Tidy up later'])
})

test('generates proposal, tasks and design; T<n> maps to 1.<n> and keeps [x]', () => {
  const generated = generateChange('parser-rewrite', parseOdd(ODD), '2026-10-04')
  const tasks = generated.files['openspec/changes/parser-rewrite/tasks.md']
  expect(tasks).toContain('- [ ] 1.1 Measure the baseline')
  expect(tasks).toContain('- [x] 1.2 Add parser')
  expect(generated.files['openspec/changes/parser-rewrite/proposal.md']).toContain('## Why\n\nThe parser is slow.\n\nBoards lag.')
  expect(generated.files['openspec/changes/parser-rewrite/proposal.md']).toContain('## What Changes\n\nParse tasks faster.')
  expect(generated.files['openspec/changes/parser-rewrite/design.md']).toContain('## Constraints\n\nNo new dependencies.')
  expect(generated.history).toEqual([{ label: '1.1', route: 'inline' }, { label: '1.2', route: 'inline', commit: 'abc123' }])
})

test('the preview lists files, tasks, unparsed lines and the confirm command with a stable digest', () => {
  const doc = parseOdd(ODD)
  const generated = generateChange('parser-rewrite', doc, '2026-10-04')
  const digest = digestOf(generated.files)
  expect(digest).toMatch(/^[0-9a-f]{8}$/)
  expect(digestOf(generated.files)).toBe(digest)
  expect(digestOf({ ...generated.files, extra: 'x' })).not.toBe(digest)
  const preview = previewText('parser-rewrite', doc, generated)
  expect(preview).toContain('nothing written yet')
  expect(preview).toContain('openspec/changes/parser-rewrite/tasks.md')
  expect(preview).toContain('Unparsed lines (not imported):\n  - [ ] Tidy up later')
  expect(preview).toContain(`/zboard import-odd parser-rewrite --confirm ${digest}`)
})
