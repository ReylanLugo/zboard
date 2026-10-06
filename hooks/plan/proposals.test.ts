import { expect, test } from 'claude-code/testing'

import { unifiedDiff } from './diff.ts'
import { buildProposal, isStale, normalizeRel, proposalText, revertSteps, scopeError, staleFiles } from './proposals.ts'

const source = { kind: 'draft' as const, artifact: 'design' }
const input = (files: { path: string; content: string }[], current: Record<string, string | null> = {}) =>
  ({ id: 'p1', changeId: 'a', artifact: 'design', reason: 'comment', files, current, source })

test('unified diff of a one-line change keeps three lines of context', () => {
  const before = 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\n'
  const after = 'l1\nl2\nl3\nl4\nL5\nl6\nl7\nl8\n'
  expect(unifiedDiff('x.md', before, after)).toBe(
    '--- a/x.md\n+++ b/x.md\n@@ -2,7 +2,7 @@\n l2\n l3\n l4\n-l5\n+L5\n l6\n l7\n l8\n',
  )
})

test('a new file diffs against /dev/null; identical content has no diff', () => {
  expect(unifiedDiff('v.md', null, 'a\nb\n')).toBe('--- /dev/null\n+++ b/v.md\n@@ -0,0 +1,2 @@\n+a\n+b\n')
  expect(unifiedDiff('v.md', 'same\n', 'same\n')).toBe('')
})

test('distant changes become separate hunks', () => {
  const lines = Array.from({ length: 30 }, (_, index) => `l${index + 1}`)
  const changed = lines.map(line => (line === 'l2' || line === 'l28' ? `${line}!` : line))
  const diff = unifiedDiff('x.md', `${lines.join('\n')}\n`, `${changed.join('\n')}\n`)
  expect(diff.split('\n').filter(line => line.startsWith('@@'))).toEqual(['@@ -1,5 +1,5 @@', '@@ -25,6 +25,6 @@'])
})

test('a 3000-line file with one change diffs in one hunk', () => {
  const lines = Array.from({ length: 3_000 }, (_, index) => `line ${index}`)
  const after = lines.map(line => (line === 'line 1500' ? 'changed' : line))
  expect(unifiedDiff('big.md', lines.join('\n'), after.join('\n')).match(/^@@/gm)).toHaveLength(1)
})

test('write scope refuses every path outside the own change directory', () => {
  expect(scopeError('hooks/register.tsx', 'a')).toBe('refused path hooks/register.tsx: outside openspec/changes/a/')
  expect(scopeError('openspec/specs/export/spec.md', 'a')).toBe('refused path openspec/specs/export/spec.md: only openspec archive writes openspec/specs/')
  expect(scopeError('openspec/changes/a/../b/proposal.md', 'a')).toBe('refused path openspec/changes/a/../b/proposal.md: absolute, traversal or malformed')
  expect(scopeError('/repo/openspec/changes/a/design.md', 'a')).toMatch(/absolute/)
  expect(scopeError('openspec\\changes\\a\\design.md', 'a')).toMatch(/malformed/)
  expect(scopeError('openspec/changes/b/design.md', 'a')).toMatch(/outside openspec\/changes\/a\//)
  expect(scopeError('openspec/changes/ab/design.md', 'a')).toMatch(/outside/)
  expect(scopeError('openspec/changes/a/./design.md', 'a')).toBeUndefined()
  expect(normalizeRel('openspec/changes/a/./specs//x/spec.md')).toBe('openspec/changes/a/specs/x/spec.md')
})

test('a proposal keeps before (null for a new file) and the normalized path', () => {
  const built = buildProposal(input(
    [{ path: 'openspec/changes/a/./design.md', content: 'new\n' }, { path: 'openspec/changes/a/verify.md', content: 'v\n' }],
    { 'openspec/changes/a/design.md': 'old\n', 'openspec/changes/a/verify.md': null },
  ))
  expect(built).toEqual({
    ok: true,
    proposal: {
      id: 'p1', artifact: 'design', reason: 'comment', status: 'pending', source,
      files: [
        { path: 'openspec/changes/a/design.md', before: 'old\n', after: 'new\n' },
        { path: 'openspec/changes/a/verify.md', before: null, after: 'v\n' },
      ],
    },
  })
})

test('a refused path, a repeated path, an empty or a no-op file set builds no proposal', () => {
  expect(buildProposal(input([{ path: 'hooks/register.tsx', content: 'x' }]))).toEqual({ ok: false, error: 'refused path hooks/register.tsx: outside openspec/changes/a/' })
  expect(buildProposal(input([{ path: 'openspec/changes/a/design.md', content: 'x' }, { path: 'openspec/changes/a/./design.md', content: 'y' }])))
    .toEqual({ ok: false, error: 'the proposal names openspec/changes/a/design.md twice' })
  expect(buildProposal(input([]))).toEqual({ ok: false, error: 'the proposal changes no file' })
  expect(buildProposal(input([{ path: 'openspec/changes/a/design.md', content: 'same\n' }], { 'openspec/changes/a/design.md': 'same\n' })))
    .toEqual({ ok: false, error: 'the proposal changes nothing' })
})

test('staleness: changed content or a file that appeared since the proposal', () => {
  const built = buildProposal(input(
    [{ path: 'openspec/changes/a/design.md', content: 'new\n' }, { path: 'openspec/changes/a/verify.md', content: 'v\n' }],
    { 'openspec/changes/a/design.md': 'old\n', 'openspec/changes/a/verify.md': null },
  ))
  if (!built.ok) throw new Error(built.error)
  const p = built.proposal
  expect(isStale(p, { 'openspec/changes/a/design.md': 'old\n', 'openspec/changes/a/verify.md': null })).toBe(false)
  expect(staleFiles(p, { 'openspec/changes/a/design.md': 'edited\n', 'openspec/changes/a/verify.md': null })).toEqual(['openspec/changes/a/design.md'])
  expect(staleFiles(p, { 'openspec/changes/a/design.md': 'old\n', 'openspec/changes/a/verify.md': 'exists\n' })).toEqual(['openspec/changes/a/verify.md'])
  expect(revertSteps(p)).toEqual([
    { kind: 'write', path: 'openspec/changes/a/design.md', text: 'old\n' },
    { kind: 'remove', path: 'openspec/changes/a/verify.md' },
  ])
  expect(proposalText(p)).toContain('-old\n+new')
})
