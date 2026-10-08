import { expect, test } from 'claude-code/testing'

import type { EventBody } from '../domain/events.ts'
import { project } from '../domain/project.ts'
import { evs, loaded, parsed } from '../testing/factories.ts'
import { EMPTY_AGENT_CACHE, agentCell, withBoard } from './agent-cache.ts'
import { deliverNote, reentryNote } from './reentry-notes.ts'

const started: EventBody = { type: 'PhaseStarted', taskId: '1.1', phase: 'code', attempt: 1, agentId: 'a1', agentType: 'zboard:implementer', role: 'implementer', model: 'm', baseline: {} }
const commented: EventBody = { type: 'CommentAdded', taskId: '1.1', comment: { id: 'c1', author: 'user', text: 'use the cache' } }
const cell = () => agentCell(withBoard(EMPTY_AGENT_CACHE, project(evs([loaded(parsed('1.1')), started, commented]))))
const REENTRY = { error: { kind: 're-entry' }, called: false } as const

test('re-entry: a pending comment rides the agent\'s tool result once and its delivery waits for ordinary context', () => {
  const agents = cell()
  const found = reentryNote(agents.get(), 'a1', REENTRY)
  expect(found?.note).toContain('use the cache')
  const ran = deliverNote(agents, found, { result: 'ok', context: ['earlier'] })
  expect(ran).toEqual({ result: 'ok', context: ['earlier', found?.note ?? ''] })
  expect(agents.get().pending).toEqual([{ type: 'CommentDelivered', taskId: '1.1', commentId: 'c1', to: 'zboard:implementer' }])
  expect(reentryNote(agents.get(), 'a1', REENTRY)).toBeUndefined()
})

test('re-entry: a denied tool call delivers nothing and marks nothing delivered', () => {
  const agents = cell()
  const found = reentryNote(agents.get(), 'a1', REENTRY)
  expect(deliverNote(agents, found, { deny: 'no' })).toEqual({ deny: 'no' })
  expect(agents.get().pending).toEqual([])
})

test('no note outside re-entry, for the main session, for an unknown agent or before the board loads', () => {
  const agents = cell()
  expect(reentryNote(agents.get(), 'a1', { error: { kind: 'throw' }, called: true })).toBeUndefined()
  expect(reentryNote(agents.get(), undefined, REENTRY)).toBeUndefined()
  expect(reentryNote(agents.get(), 'ghost', REENTRY)).toBeUndefined()
  expect(reentryNote(EMPTY_AGENT_CACHE, 'a1', REENTRY)).toBeUndefined()
  const ran: { readonly result: string; readonly deny?: string } = { result: 'ok' }
  expect(deliverNote(agents, undefined, ran)).toBe(ran)
})
