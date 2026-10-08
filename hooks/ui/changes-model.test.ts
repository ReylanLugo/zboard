import { expect, test } from 'claude-code/testing'

import { projectPlan } from '../plan/plan-project.ts'
import type { ChangeStage } from '../plan/types.ts'
import { NO_ROOT_LIST_JSON } from '../testing/openspec.ts'
import { listing, marks, record } from '../testing/plan.ts'
import { GROUPS, STAGE_ICONS, groupTitle, headerText, rowLabel } from './changes-model.ts'

test('the header counts one issue in the singular and two in the plural', () => {
  const one = projectPlan([{ type: 'PlanError', hook: 'new change', message: 'x', seq: 1, at: 1 }])
  expect(headerText(one)).toBe('zboard changes · 0 active · 0 drafts · 0 archived · ⚠ 1 issue')
  const two = projectPlan([
    { type: 'ChangesListed', complete: true, changes: [], error: 'openspec: boom', seq: 1, at: 1 },
    { type: 'PlanError', hook: 'new change', message: 'x', seq: 2, at: 2 },
  ])
  expect(headerText(two)).toBe('zboard changes · 0 active · 0 drafts · 0 archived · ⚠ 2 issues')
})

test('a folder without OpenSpec is a state, not an issue', () => {
  const plan = projectPlan([{ type: 'ChangesListed', complete: true, changes: [], error: NO_ROOT_LIST_JSON, seq: 1, at: 1 }])
  expect(headerText(plan)).toBe('zboard changes · OpenSpec not initialized')
})

test('every stage has its icon', () => {
  const expected: Readonly<Record<ChangeStage, string>> = {
    draft: '✎', authoring: '◐', ready: '●', executing: '▶', verifying: '◆', retrospective: '◆', archiving: '◆', archived: '✓',
  }
  expect(STAGE_ICONS).toEqual(expected)
})

test('a row shows the stage icon, and a progress bar when the change has tasks', () => {
  const tasks = marks('1.1:x', '1.2:x', '1.3:x', '1.4', '1.5')
  expect(rowLabel(record({ stage: 'executing', tasks }, 'add-export'))).toBe('▶ add-export · executing · ▓▓▓░░ 3/5')
  expect(rowLabel(record({ stage: 'draft' }, 'idea'))).toBe('✎ idea · draft')
  expect(rowLabel(record({ stage: 'draft', listError: 'boom' }, 'broken'))).toBe('✎ broken · draft · ⚠ error')
})

test('group titles align their counts', () => {
  const plan = projectPlan([{ type: 'ChangesListed', complete: true, changes: [listing('a'), listing('b', { archived: true })], seq: 1, at: 1 }])
  expect(GROUPS.map(group => groupTitle(plan, group))).toEqual(['Active   (0)', 'Drafts   (1)', 'Archived (1)'])
})
