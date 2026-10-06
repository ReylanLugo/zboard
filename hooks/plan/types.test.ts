import { expect, test } from 'claude-code/testing'

import { CHANGE_NAME_MAX, changeDir, emptyPlanBoard, emptyRecord, isPlanChangeName, isPlanRole } from './types.ts'

test('kebab-case change ids are accepted', () => {
  for (const id of ['add-export', 'a', 'zboard-v1', '2026-01-01-c', 'x'.repeat(CHANGE_NAME_MAX)]) expect(isPlanChangeName(id)).toBe(true)
})

test('traversal, option injection and malformed ids are refused', () => {
  const refused = ['../../etc', '../x', '--yes', '-a', 'a/b', 'a\\b', '/abs', 'Add-Export', 'a_b', 'a.b', 'a--b', 'a-', '', 'x'.repeat(CHANGE_NAME_MAX + 1), 'a..b']
  for (const id of refused) expect(isPlanChangeName(id)).toBe(false)
})

test('an empty record is a draft without history', () => {
  expect(emptyRecord('add-export')).toEqual({
    id: 'add-export', stage: 'draft', archived: false, listed: false, fingerprint: '', tasks: [], readiness: [], created: false,
    revisions: [], runStarted: false, executionFinished: false, retrospectiveAccepted: false, archiving: false, errors: [],
  })
  expect(emptyPlanBoard).toEqual({ changes: {}, order: [], errors: [], mirrorPending: false })
  expect(changeDir('add-export')).toBe('openspec/changes/add-export')
  expect(isPlanRole('judge')).toBe(true)
  expect(isPlanRole('reviewer')).toBe(false)
})
