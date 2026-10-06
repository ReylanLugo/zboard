import { expect, test } from 'claude-code/testing'

import type { JudgeRaw } from './contracts.ts'
import { canResolve, findingId, isCitableTest, normalizeFindings, verifyMarkdown } from './findings.ts'

const FIVE = ['Export CSV', 'Import CSV', 'Delete CSV', 'Rename CSV', 'Merge CSV']
const raw = (requirement: string, verdict: string, evidence: string[] = [], tests: string[] = []): JudgeRaw => ({ requirement, verdict, evidence, tests })
const pass = { file: 'tests/export.test.ts', kind: 'pass' as const, endLine: 'ptest: demo · passed · 3 tests' }

test('true needs path:line evidence and every cited test passing', () => {
  const findings = normalizeFindings({
    raw: [raw('Export CSV', 'true', ['src/export.ts:12'], ['tests/export.test.ts']), raw('Import CSV', 'true', []), raw('Delete CSV', 'true', ['src/delete.ts:3'], ['tests/delete.test.ts'])],
    requirements: FIVE.slice(0, 3), scope: [],
    tests: { 'tests/export.test.ts': pass, 'tests/delete.test.ts': { file: 'tests/delete.test.ts', kind: 'incomplete', endLine: 'ptest: incomplete (exit 70)' } },
    present: new Set(['src/export.ts', 'src/delete.ts']),
  })
  expect(findings.map(f => [f.requirement, f.verdict])).toEqual([['Export CSV', 'true'], ['Import CSV', 'no_evidence'], ['Delete CSV', 'no_evidence']])
  expect(findings[0]?.evidence).toEqual(['src/export.ts:12', 'ptest tests/export.test.ts: ptest: demo · passed · 3 tests'])
})

test('invalid judge output makes every requirement no_evidence and none true', () => {
  const findings = normalizeFindings({ raw: undefined, requirements: FIVE, scope: [], tests: {}, present: new Set() })
  expect(findings.map(f => f.verdict)).toEqual(['no_evidence', 'no_evidence', 'no_evidence', 'no_evidence', 'no_evidence'])
})

test('an omitted requirement is no_evidence; an unknown verdict is ambiguous; a requirement outside the change is dropped', () => {
  const findings = normalizeFindings({
    raw: [raw('Export CSV', 'false', ['src/export.ts:1']), raw('Import CSV', 'probably'), raw('Delete CSV', 'contradiction'), raw('Rename CSV', 'no_evidence'), raw('Unrelated', 'true', ['a.ts:1'])],
    requirements: FIVE, scope: [], tests: {}, present: new Set(['src/export.ts', 'a.ts']),
  })
  expect(findings.map(f => [f.requirement, f.verdict])).toEqual([
    ['Export CSV', 'false'], ['Import CSV', 'ambiguous'], ['Delete CSV', 'contradiction'], ['Rename CSV', 'no_evidence'], ['Merge CSV', 'no_evidence'],
  ])
  expect(findings.at(-1)?.evidence).toEqual(['the judge gave no verdict'])
})

test('a scoped run judges only its requirements; scenario findings get their own ids', () => {
  const tests = { 'tests/import.test.ts': { file: 'tests/import.test.ts', kind: 'pass' as const, endLine: 'ptest: demo · passed · 2 tests' } }
  const findings = normalizeFindings({
    raw: [{ ...raw('Import CSV', 'true', ['src/import.ts:4'], ['tests/import.test.ts']), scenario: 'Bad rows' }],
    requirements: FIVE, scope: ['Import CSV'], tests, present: new Set(['src/import.ts']),
  })
  expect(findings).toEqual([{ id: 'r:import-csv#bad-rows', requirement: 'Import CSV', scenario: 'Bad rows', verdict: 'true', evidence: ['src/import.ts:4', 'ptest tests/import.test.ts: ptest: demo · passed · 2 tests'] }])
  expect(findingId('Export CSV')).toBe('r:export-csv')
})

test('true without a cited passing test, or citing a missing evidence file, is no_evidence', () => {
  const findings = normalizeFindings({
    raw: [
      raw('Export CSV', 'true', ['src/export.ts:12']),
      raw('Import CSV', 'true', ['src/missing.ts:4'], ['tests/export.test.ts']),
      raw('Delete CSV', 'true', ['src/export.ts:12', 'src/missing.ts:1'], ['tests/export.test.ts']),
      raw('Rename CSV', 'true', ['src/export.ts:12'], ['tests/empty.test.ts']),
    ],
    requirements: FIVE.slice(0, 4), scope: [],
    tests: { 'tests/export.test.ts': pass, 'tests/empty.test.ts': { file: 'tests/empty.test.ts', kind: 'unknown', endLine: 'ptest: no changes vs main — nothing to test' } },
    present: new Set(['src/export.ts']),
  })
  expect(findings.map(f => f.verdict)).toEqual(['no_evidence', 'no_evidence', 'no_evidence', 'no_evidence'])
})

test('duplicate verdicts for one requirement keep the worst and merge their evidence', () => {
  const findings = normalizeFindings({
    raw: [
      raw('Export CSV', 'true', ['src/export.ts:12'], ['tests/export.test.ts']),
      raw('Export CSV', 'false', ['src/export.ts:20']),
      raw('Import CSV', 'no_evidence', ['nothing cites it']),
      raw('Import CSV', 'ambiguous', ['two readings']),
      { ...raw('Delete CSV', 'contradiction', ['spec vs code']), scenario: 'Bulk' },
      { ...raw('Delete CSV', 'true', ['src/export.ts:12'], ['tests/export.test.ts']), scenario: 'Bulk' },
    ],
    requirements: FIVE.slice(0, 3), scope: [], tests: { 'tests/export.test.ts': pass }, present: new Set(['src/export.ts']),
  })
  expect(findings.map(f => [f.id, f.verdict])).toEqual([['r:export-csv', 'false'], ['r:import-csv', 'ambiguous'], ['r:delete-csv#bulk', 'contradiction']])
  expect(findings[0]?.evidence).toEqual(['src/export.ts:12', 'ptest tests/export.test.ts: ptest: demo · passed · 3 tests', 'src/export.ts:20'])
  expect(findings[1]?.evidence).toEqual(['nothing cites it', 'two readings'])
})

test('resolutions follow the verdict table', () => {
  expect(canResolve('false', 'accepted')).toBe(false)
  expect(canResolve('false', 'fix_code')).toBe(true)
  expect(canResolve('contradiction', 'adjust_spec')).toBe(true)
  expect(canResolve('no_evidence', 'add_test')).toBe(true)
  expect(canResolve('no_evidence', 'fix_code')).toBe(false)
  expect(canResolve('ambiguous', 'accepted')).toBe(true)
  expect(canResolve('true', 'accepted')).toBe(false)
})

test('only plain repository-relative test paths may be run', () => {
  expect(isCitableTest('tests/export.test.ts')).toBe(true)
  for (const path of ['/etc/passwd', '../x.test.ts', '--full', 'tests/--watch', './tests/a.test.ts', 'tests\\a.ts', '']) expect(isCitableTest(path)).toBe(false)
})

test('verify.md lists verdicts, resolutions and accepted risks', () => {
  const md = verifyMarkdown('add-export', [
    { id: 'r:export-csv', requirement: 'Export CSV', verdict: 'true', evidence: ['src/export.ts:12'] },
    { id: 'r:import-csv', requirement: 'Import CSV', verdict: 'no_evidence', evidence: ['the judge gave no verdict'], resolution: 'accepted' },
  ])
  expect(md).toContain('# Verify: add-export')
  expect(md).toContain('| Export CSV | – | true | – | src/export.ts:12 |')
  expect(md).toContain('| Import CSV | – | no_evidence | accepted | the judge gave no verdict |')
  expect(md).toContain('## Accepted risks\n\n- Import CSV: no_evidence, accepted without evidence')
})
