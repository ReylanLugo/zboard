import { expect, test } from 'claude-code/testing'

import { parseBrainstorm, parseCritique, parseDraft, parseExplanation, parseJudge } from './contracts.ts'

const fence = (value: unknown): string => `Here it is.\n\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\`\n`

test('missing or prose answers are rejected with a reason', () => {
  expect(parseDraft(undefined)).toEqual({ ok: false, reason: 'the agent gave no answer' })
  expect(parseDraft('I updated the file for you.')).toEqual({ ok: false, reason: 'no valid ```json block with an object' })
})

test('brainstorm: one question with options and why, or done with the brainstorm text', () => {
  expect(parseBrainstorm(fence({ question: 'Who?', options: ['A', 'B'], why: 'scope' }))).toEqual({ ok: true, value: { kind: 'question', question: 'Who?', options: ['A', 'B'], why: 'scope' } })
  expect(parseBrainstorm(fence({ done: true, brainstorm: '# Brainstorm' }))).toEqual({ ok: true, value: { kind: 'done', brainstorm: '# Brainstorm' } })
  expect(parseBrainstorm(fence({ question: 'Who?', why: 'x' })).ok).toBe(false)
  expect(parseBrainstorm(fence({ question: 'Q', options: ['1', '2', '3', '4', '5', '6', '7'], why: 'w' }))).toEqual({ ok: false, reason: 'at most 6 options' })
  expect(parseBrainstorm(fence({ done: true, brainstorm: '' })).ok).toBe(false)
})

test('draft: every file needs a path and content', () => {
  expect(parseDraft(fence({ files: [{ path: 'openspec/changes/a/proposal.md', content: '## Why' }], notes: 'n' })))
    .toEqual({ ok: true, value: { files: [{ path: 'openspec/changes/a/proposal.md', content: '## Why' }], notes: 'n' } })
  expect(parseDraft(fence({ files: [] }))).toEqual({ ok: false, reason: '"files" must list at least one file' })
  expect(parseDraft(fence({ files: [{ path: 'x' }] }))).toEqual({ ok: false, reason: 'every file needs a string "path" and "content"' })
})

test('explanation: overview, sections and diagrams', () => {
  const value = { overview: 'O', sections: [{ title: 'T', body: 'B' }], diagrams: [{ title: 'Flow', mermaid: 'graph TD; A-->B' }] }
  expect(parseExplanation(fence(value))).toEqual({ ok: true, value })
  expect(parseExplanation(fence({ overview: '', sections: [], diagrams: [] })).ok).toBe(false)
})

test('critique: severity, artifact id, issue and suggestion; an artifact path becomes its id', () => {
  const finding = { severity: 'high', artifact: 'openspec/changes/a/design.md', issue: 'I', suggestion: 'S' }
  expect(parseCritique(fence({ findings: [finding] }))).toEqual({ ok: true, value: { findings: [{ ...finding, artifact: 'design' }] } })
  expect(parseCritique(fence({ findings: [{ ...finding, severity: 'urgent' }] })).ok).toBe(false)
})

test('judge: requirement and verdict required, evidence and tests default to empty', () => {
  expect(parseJudge(fence({ findings: [{ requirement: 'Export CSV', verdict: 'true', evidence: ['src/a.ts:3'], tests: ['tests/a.test.ts'] }, { requirement: 'Import CSV', verdict: 'maybe' }] })))
    .toEqual({ ok: true, value: { findings: [
      { requirement: 'Export CSV', verdict: 'true', evidence: ['src/a.ts:3'], tests: ['tests/a.test.ts'] },
      { requirement: 'Import CSV', verdict: 'maybe', evidence: [], tests: [] },
    ] } })
  expect(parseJudge(fence({ findings: [{ verdict: 'true' }] })).ok).toBe(false)
})
