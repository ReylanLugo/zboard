import { expect, test } from 'claude-code/testing'

import { repairInstruction, repairTargets } from './repair.ts'
import type { ReadinessCheck } from './types.ts'

const failing = (id: ReadinessCheck['id'], subjects: readonly string[]): ReadinessCheck =>
  ({ id, ok: false, detail: 'x', failures: subjects.map(label => `${label} x`), subjects })
const passing = (id: ReadinessCheck['id']): ReadinessCheck => ({ id, ok: true, detail: 'ok' })

test('repair targets are the tasks the coverage and acceptance checks name', () => {
  const targets = repairTargets([passing('validate'), failing('coverage', ['1.1', '1.2']), failing('acceptance', ['1.2', '1.3'])])
  expect(targets).toEqual({ noRequirement: ['1.1', '1.2'], noAcceptance: ['1.2', '1.3'] })
})

test('other failing checks and old persisted checks without subjects give no targets', () => {
  expect(repairTargets([failing('size', ['1.1']), passing('coverage')])).toEqual({ noRequirement: [], noAcceptance: [] })
  expect(repairTargets([{ id: 'coverage', ok: false, detail: '1.1 names no requirement' }])).toEqual({ noRequirement: [], noAcceptance: [] })
})

test('the instruction lists the requirement names, the tasks missing each part and the invariants', () => {
  const text = repairInstruction(['Export CSV', 'Import CSV'], { noRequirement: ['1.1', '1.2'], noAcceptance: ['1.2'] })
  expect(text).toContain('[req: <Requirement name>]')
  expect(text).toContain('Acceptance:')
  expect(text).toContain('- Export CSV')
  expect(text).toContain('- Import CSV')
  expect(text).toContain('no requirement tag: 1.1, 1.2')
  expect(text).toContain('no acceptance line: 1.2')
  expect(text).toMatch(/do not change.*ids.*order.*checkbox/i)
})

test('with no known task labels the instruction targets every task that lacks the parts', () => {
  expect(repairInstruction(['Export CSV'], { noRequirement: [], noAcceptance: [] })).toContain('every task that lacks them')
})
