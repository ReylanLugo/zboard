import { expect, test } from 'claude-code/testing'

import { evs, loaded, parsed } from '../testing/factories.ts'
import { noticesBetween } from './notices.ts'
import { project } from './project.ts'

const almost = project(evs([loaded(parsed('1.1')), { type: 'TaskStatusChanged', taskId: '1.1', from: 'review', to: 'running' }]))
const done = project(evs([loaded(parsed('1.1')), { type: 'TaskStatusChanged', taskId: '1.1', from: 'review', to: 'done' }]))

test('with a configured test command the completion notice asks for the project full suite, not ptest', () => {
  expect(noticesBetween(almost, done, 'custom')).toEqual([
    'zboard: change demo is complete (1/1 tasks done). The integrated full-suite gate is still required before handoff: run the project\'s full test suite.',
  ])
})

test('with ptest the completion notice keeps the ptest --full wording', () => {
  const expected = ['zboard: change demo is complete (1/1 tasks done). The integrated `ptest --full` gate is still required before handoff.']
  expect(noticesBetween(almost, done, 'ptest')).toEqual(expected)
  expect(noticesBetween(almost, done)).toEqual(expected)
})
