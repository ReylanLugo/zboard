import { expect, test } from 'claude-code/testing'

import { nextView, prefsFrom } from './prefs.ts'

test('stored preferences are validated before use', () => {
  expect(prefsFrom({ view: 'swimlane', filter: { kind: 'status', value: 'needs_decision' } })).toEqual({
    view: 'swimlane', filter: { kind: 'status', value: 'needs_decision' },
  })
  expect(prefsFrom({ view: 'swimlane', filter: { kind: 'status', value: 'nonsense' } })).toEqual({ view: 'swimlane', filter: { kind: 'none' } })
  expect(prefsFrom({ view: 'gallery' })).toBeUndefined()
  expect(prefsFrom('junk')).toBeUndefined()
})

test('the view cycles Kanban → Swimlanes → Tree → Kanban', () => {
  expect(nextView('kanban')).toBe('swimlane')
  expect(nextView('swimlane')).toBe('tree')
  expect(nextView('tree')).toBe('kanban')
})
