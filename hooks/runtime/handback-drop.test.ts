import { expect, test } from 'claude-code/testing'

import type { EventBody } from '../domain/events.ts'
import { project } from '../domain/project.ts'
import { evs, loaded, parsed } from '../testing/factories.ts'
import { agentMessage } from '../testing/zboard.ts'
import { EMPTY_AGENT_CACHE, withBoard } from './agent-cache.ts'
import { agentMessageFrom, caughtPrompt, handbackDrop } from './handback-drop.ts'

const started: EventBody = { type: 'PhaseStarted', taskId: '1.1', phase: 'research', attempt: 1, agentId: 'a1', agentType: 'zboard:researcher', role: 'researcher', model: 'm', baseline: {} }
const stopped: EventBody = { type: 'AgentStopped', agentId: 'a1' }
const cache = { ...withBoard(EMPTY_AGENT_CACHE, project(evs([loaded(parsed('1.1')), started, stopped]))), planRoles: new Map([['p1', 'critic']]) }
const peer = (agentId: string, report = 'the report') => ({ text: agentMessage(agentId, report), origin: { kind: 'peer' } })

test('the agent id is read from the head of an agent-message hand-back only', () => {
  expect(agentMessageFrom(agentMessage('a1', 'r'))).toBe('a1')
  expect(agentMessageFrom('  <agent-message from="a-2">x</agent-message>')).toBe('a-2')
  expect(agentMessageFrom('please read <agent-message from="a1">')).toBeUndefined()
  expect(agentMessageFrom('<agent-message>x</agent-message>')).toBeUndefined()
})

test('a peer hand-back from a zboard board or plan agent, ended or not, is dropped with a pointer to the pane', () => {
  expect(handbackDrop(cache, peer('a1'))).toBe('zboard captured the researcher report; see the zboard pane.')
  expect(handbackDrop(cache, peer('p1'))).toBe('zboard captured the critic report; see the zboard pane.')
})

test('a stranger\'s hand-back, a non-peer prompt and an unloaded cache pass untouched', () => {
  expect(handbackDrop(cache, peer('stranger'))).toBeUndefined()
  expect(handbackDrop(cache, { text: agentMessage('a1', 'r'), origin: { kind: 'composer' } })).toBeUndefined()
  expect(handbackDrop(cache, { text: agentMessage('a1', 'r') })).toBeUndefined()
  expect(handbackDrop(EMPTY_AGENT_CACHE, peer('a1'))).toBeUndefined()
})

test('the prompt hook\'s handler drops on re-entry and passes once the hook had called next', () => {
  expect(caughtPrompt(cache, peer('a1'), { error: { kind: 're-entry' }, called: false })).toBe('zboard captured the researcher report; see the zboard pane.')
  expect(caughtPrompt(cache, peer('a1'), { error: { kind: 'throw' }, called: true })).toBeUndefined()
  expect(caughtPrompt(cache, peer('stranger'), { error: { kind: 're-entry' }, called: false })).toBeUndefined()
})
