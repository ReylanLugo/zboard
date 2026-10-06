import { expect, test } from 'claude-code/testing'

import { parseTasksMd } from '../adapters/tasks-md.ts'
import { coveringTasks, findCycle, parseRequirements, readinessChecks } from './readiness.ts'

const SPEC = [
  '## ADDED Requirements', '',
  '### Requirement: Export CSV', 'The system SHALL export.', '', '#### Scenario: Export', '- **WHEN** x', '- **THEN** y', '',
  '### Requirement: Import CSV', 'The system SHALL import.', '', '#### Scenario: Import', '- **WHEN** x', '- **THEN** y', '',
].join('\n')
const specs = [{ path: 'openspec/changes/a/specs/csv/spec.md', text: SPEC }]
const valid = { ok: true, detail: 'valid' }
const tasksOf = (text: string) => parseTasksMd(text).tasks
const GOOD = '## 1. Core\n\n- [ ] 1.1 Export CSV writer\n  Acceptance: file written\n- [ ] 1.2 Reader [req: import csv]\n  Acceptance: rows read\n'
const byId = (checks: ReturnType<typeof readinessChecks>) => Object.fromEntries(checks.map(check => [check.id, check]))

test('every check passes for a well-formed change', () => {
  const checks = readinessChecks({ validate: valid, specs, tasks: tasksOf(GOOD) })
  expect(checks.map(check => [check.id, check.ok])).toEqual([
    ['validate', true], ['scenarios', true], ['coverage', true], ['cycles', true], ['size', true], ['acceptance', true],
  ])
})

test('coverage names the task that names no requirement', () => {
  const text = `${GOOD}\n## 2. More\n\n- [ ] 2.1 Export CSV headers\n  Acceptance: x\n- [ ] 2.2 Import CSV errors\n  Acceptance: x\n- [ ] 2.3 Unrelated cleanup\n  Acceptance: x\n`
  expect(byId(readinessChecks({ validate: valid, specs, tasks: tasksOf(text) })).coverage).toEqual({ id: 'coverage', ok: false, detail: '2.3 names no requirement' })
})

test('a dependency cycle fails and names both tasks', () => {
  const text = '## 1. A\n\n- [ ] 1.1 Export CSV\n  Acceptance: x\n- [ ] 1.2 Import CSV depends on 2.1\n  Acceptance: x\n\n## 2. B\n\n- [ ] 2.1 Export CSV depends on 1.2\n  Acceptance: x\n'
  expect(findCycle(tasksOf(text))).toEqual(['1.2', '2.1', '1.2'])
  expect(byId(readinessChecks({ validate: valid, specs, tasks: tasksOf(text) })).cycles).toEqual({ id: 'cycles', ok: false, detail: 'cycle: 1.2 → 2.1 → 1.2' })
})

test('a requirement without a scenario fails scenarios and is named', () => {
  const spec = { path: 'openspec/changes/a/specs/del/spec.md', text: '## ADDED Requirements\n\n### Requirement: Delete CSV\nThe system SHALL delete.\n' }
  expect(byId(readinessChecks({ validate: valid, specs: [...specs, spec], tasks: tasksOf(GOOD) })).scenarios).toEqual({ id: 'scenarios', ok: false, detail: 'Delete CSV has no scenario' })
})

test('size limits task text and group length', () => {
  const long = `- [ ] 1.1 Export CSV ${'x'.repeat(600)}\n  Acceptance: x\n`
  expect(byId(readinessChecks({ validate: valid, specs, tasks: tasksOf(`## 1. Core\n\n${long}`) })).size?.detail).toMatch(/^1\.1 is \d+ characters \(max 600\)$/)
  const many = Array.from({ length: 13 }, (_, index) => `- [ ] 1.${index + 1} Export CSV part\n  Acceptance: x\n`).join('')
  expect(byId(readinessChecks({ validate: valid, specs, tasks: tasksOf(`## 1. Core\n\n${many}`) })).size?.detail).toBe('1. Core has 13 tasks (max 12)')
})

test('acceptance comes from tasks.md or from the task section of plan.md', () => {
  const bare = '## 1. Core\n\n- [ ] 1.1 Export CSV writer\n- [ ] 1.2 Import CSV reader\n'
  const plan = '# Plan\n\n### Task 1.1: Writer\n\n**Acceptance:** a file is written\n\n### Task 1.2: Reader\n\nNo criteria here.\n'
  expect(byId(readinessChecks({ validate: valid, specs, tasks: tasksOf(bare), planMd: plan })).acceptance)
    .toEqual({ id: 'acceptance', ok: false, detail: '1.2 has no acceptance criteria' })
})

test('a failing validation passes its output through', () => {
  const checks = byId(readinessChecks({ validate: { ok: false, detail: 'ERROR: specs/x/spec.md missing scenario' }, specs, tasks: tasksOf(GOOD) }))
  expect(checks.validate).toEqual({ id: 'validate', ok: false, detail: 'ERROR: specs/x/spec.md missing scenario' })
})

test('CRLF specs and tasks parse to the same names and checks', () => {
  const crlf = [{ path: specs[0]?.path ?? '', text: SPEC.replace(/\n/g, '\r\n') }]
  expect(parseRequirements(crlf).map(r => r.name)).toEqual(['Export CSV', 'Import CSV'])
  const checks = readinessChecks({ validate: valid, specs: crlf, tasks: tasksOf(GOOD.replace(/\n/g, '\r\n')) })
  expect(checks.every(check => check.ok)).toBe(true)
})

test('coveringTasks maps each requirement to the tasks naming it', () => {
  expect(coveringTasks(parseRequirements(specs), tasksOf(GOOD))).toEqual({ 'Export CSV': ['1.1'], 'Import CSV': ['1.2'] })
})
