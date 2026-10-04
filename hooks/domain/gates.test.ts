import { expect, test } from 'claude-code/testing'

import { planGate, researchGate, reviewGate, touchedGate } from './gates.ts'
import { extractJson } from './json.ts'
import { normalizeInside } from './paths.ts'

const fenced = (value: unknown): string => `Here is the result.\n\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\`\n`

test('extractJson reads a bare JSON answer and a fenced block', () => {
  expect(extractJson('{"a":1}')).toEqual({ a: 1 })
  expect(extractJson(fenced({ b: 2 }))).toEqual({ b: 2 })
  expect(extractJson('approve')).toBeUndefined()
})

test('uses the last json block and never falls back to an earlier one', () => {
  const two = `${fenced({ verdict: 'changes', findings: [] })}\nFinal:\n${fenced({ verdict: 'approve', findings: [] })}`
  expect(extractJson(two)).toEqual({ verdict: 'approve', findings: [] })
  const brokenLast = `${fenced({ ok: true })}\n\`\`\`json\n{"ok": tru\n\`\`\``
  expect(extractJson(brokenLast)).toBeUndefined()
})

test('normalizeInside keeps repo-relative paths and rejects escapes', () => {
  expect(normalizeInside('src/a.ts', '/repo')).toBe('src/a.ts')
  expect(normalizeInside('/repo/src/./b.ts', '/repo')).toBe('src/b.ts')
  expect(normalizeInside('src/allowed/../../etc/passwd', '/repo')).toBe('etc/passwd')
  expect(normalizeInside('../outside/secret.ts', '/repo')).toBeUndefined()
  expect(normalizeInside('/etc/passwd', '/repo')).toBeUndefined()
  expect(normalizeInside('/repo-evil/a.ts', '/repo')).toBeUndefined()
  expect(normalizeInside('', '/repo')).toBeUndefined()
  expect(normalizeInside('.', '/repo')).toBeUndefined()
  expect(normalizeInside('src\\win\\c.ts', '/repo')).toBe('src/win/c.ts')
})

test('research gate needs at least one finding with path:line evidence', () => {
  expect(researchGate(fenced({ findings: [{ claim: 'x', evidence: 'src/a.ts:12' }] })).gate).toBe('pass')
  const noEvidence = researchGate(fenced({ findings: [{ claim: 'x', evidence: 'somewhere in src' }] }))
  expect(noEvidence).toEqual({ gate: 'fail', reason: 'research: no finding carries path:line evidence', terminal: false })
  expect(researchGate('I looked around.').gate).toBe('fail')
})

test('plan gate normalizes files and rejects paths outside the repository', () => {
  const good = planGate(fenced({ approach: 'a', allowedFiles: ['./src/a.ts'], testFiles: ['tests/a.test.ts'], testCases: ['t1'], edgeCases: [], risks: [] }), '/repo')
  expect(good).toMatchObject({ gate: 'pass', allowedFiles: ['src/a.ts'], testFiles: ['tests/a.test.ts'] })
  const outside = planGate(fenced({ allowedFiles: ['../outside/secret.ts'], testFiles: ['t.test.ts'], testCases: ['t'] }), '/repo')
  expect(outside).toEqual({ gate: 'fail', reason: 'plan: paths outside the repository: ../outside/secret.ts', terminal: false })
  const absolute = planGate(fenced({ allowedFiles: ['/etc/hosts'], testFiles: ['t.test.ts'], testCases: ['t'] }), '/repo')
  expect(absolute.gate).toBe('fail')
  expect(planGate(fenced({ allowedFiles: [], testFiles: ['t'], testCases: ['t'] }), '/repo')).toMatchObject({ reason: 'plan: allowedFiles is empty' })
  expect(planGate(fenced({ allowedFiles: ['a'], testFiles: ['t'], testCases: [] }), '/repo')).toMatchObject({ reason: 'plan: testCases is empty' })
})

test('review gate needs a valid verdict, and changes needs findings', () => {
  expect(reviewGate('approve')).toMatchObject({ gate: 'fail', reason: 'review: no valid ReviewVerdict JSON' })
  expect(reviewGate(fenced({ verdict: 'changes', findings: [] }))).toMatchObject({ gate: 'fail', reason: 'review: verdict "changes" without findings' })
  expect(reviewGate(fenced({ verdict: 'approve', findings: [{ severity: 'urgent', file: 'a', issue: 'b' }] }))).toMatchObject({ reason: 'review: a finding is malformed' })
  const approve = reviewGate(fenced({ verdict: 'approve', findings: [] }))
  expect(approve).toEqual({ gate: 'pass', summary: 'approve (0 findings)', verdict: { verdict: 'approve', findings: [] } })
})

test('touchedGate fails when a phase changed files outside its scope', () => {
  expect(touchedGate([], [], 'review')).toBeUndefined()
  expect(touchedGate(['src/a.ts'], [], 'review')).toEqual({ gate: 'fail', reason: 'review: changed files outside its scope: src/a.ts', terminal: false })
  expect(touchedGate(['src/a.ts'], ['src/a.ts'], 'code')).toBeUndefined()
})
