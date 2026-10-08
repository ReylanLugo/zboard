import { expect, test } from 'claude-code/testing'

import type { EventBody } from '../domain/events.ts'
import { project, runOf, taskOfAgent } from '../domain/project.ts'
import type { Phase, Role } from '../domain/types.ts'
import { evs, loaded, parsed } from '../testing/factories.ts'
import type { AgentCache } from './agent-cache.ts'
import { EMPTY_AGENT_CACHE, agentCell, withBoard, withRoot } from './agent-cache.ts'
import { GUARD_FAILED, caughtWrite, reentryWrite } from './reentry-guard.ts'

const ROOT = '/repo'
const planned: EventBody = { type: 'PhaseCompleted', taskId: '1.1', phase: 'plan', attempt: 1, gate: 'pass', allowedFiles: ['src/allowed/a.ts'], testFiles: ['tests/a.test.ts'] }
const boardIn = (phase: Phase, role: Role, extra: EventBody[] = []) => project(evs([
  loaded(parsed('1.1')),
  planned,
  { type: 'PhaseStarted', taskId: '1.1', phase, attempt: 1, agentId: 'a1', agentType: `zboard:${role}`, role, model: 'm', baseline: {} },
  ...extra,
]))
const cacheIn = (phase: Phase, role: Role, extra: EventBody[] = []): AgentCache =>
  withRoot(withBoard(EMPTY_AGENT_CACHE, boardIn(phase, role, extra)), ROOT)
const REENTRY = { error: { kind: 're-entry' }, called: false } as const

test('re-entry: a running agent\'s write to an allowed file passes, relative or absolute', () => {
  const cache = cacheIn('code', 'implementer')
  expect(reentryWrite(cache, 'Edit', 'a1', 'src/allowed/a.ts')).toEqual({ events: [] })
  expect(reentryWrite(cache, 'Write', 'a1', '/repo/tests/a.test.ts')).toEqual({ events: [] })
})

test('re-entry: a write outside the allowed files is denied and its GuardDenied event is queued', () => {
  const cell = agentCell(cacheIn('code', 'implementer'))
  const deny = caughtWrite(cell, 'Edit', 'a1', 'src/other.ts', REENTRY)
  expect(deny).toBe('zboard: src/other.ts is outside this task\'s allowed files (src/allowed/a.ts, tests/a.test.ts).')
  expect(cell.get().pending).toEqual([{ type: 'GuardDenied', taskId: '1.1', agentId: 'a1', path: 'src/other.ts' }])
  const board = cell.get().board
  const task = board === undefined ? undefined : taskOfAgent(board, 'a1')
  expect(task === undefined ? undefined : runOf(task, 'a1')?.denies).toBe(1)
})

test('re-entry: the third denial escalates the task to a decision, as the hook does', () => {
  const cell = agentCell(cacheIn('code', 'implementer'))
  for (const path of ['x.ts', 'y.ts', 'z.ts']) caughtWrite(cell, 'Write', 'a1', path, REENTRY)
  expect(cell.get().pending.at(-1)).toEqual({ type: 'TaskStatusChanged', taskId: '1.1', from: 'running', to: 'needs_decision', reason: 'plan too narrow' })
})

test('re-entry: a path that escapes the root is denied', () => {
  expect(reentryWrite(cacheIn('code', 'implementer'), 'Edit', 'a1', 'src/allowed/../../../etc/passwd').deny).toMatch(/outside this task's allowed files/)
})

test('re-entry: a read-only phase denies every write', () => {
  expect(reentryWrite(cacheIn('review', 'reviewer'), 'NotebookEdit', 'a1', 'src/allowed/a.ts').deny).toBe('zboard: the review phase is read-only; src/allowed/a.ts was not changed.')
})

test('re-entry: an unknown agent, an ended run, a plan agent and an unloaded cache are all denied', () => {
  const cache = cacheIn('code', 'implementer')
  expect(reentryWrite(cache, 'Edit', 'ghost', 'src/allowed/a.ts').deny).toBe('zboard: agent ghost is not a running zboard agent and its writes bypass zboard\'s hooks, so src/allowed/a.ts was not changed.')
  const ended = cacheIn('code', 'implementer', [{ type: 'AgentStopped', agentId: 'a1' }])
  expect(reentryWrite(ended, 'Edit', 'a1', 'src/allowed/a.ts').deny).toMatch(/not a running zboard agent/)
  const plan = { ...cache, planRoles: new Map([['p1', 'drafter']]) }
  expect(reentryWrite(plan, 'Write', 'p1', 'notes.md').deny).toBe('zboard: plan agents are read-only; notes.md was not changed.')
  expect(reentryWrite(EMPTY_AGENT_CACHE, 'Edit', 'a1', 'src/allowed/a.ts').deny).toBe('zboard: the board is not loaded yet, so src/allowed/a.ts was not changed.')
})

test('re-entry: a non-gated tool and the main session\'s own write pass', () => {
  expect(reentryWrite(EMPTY_AGENT_CACHE, 'Read', 'ghost', 'src/x.ts')).toEqual({ events: [] })
  expect(reentryWrite(EMPTY_AGENT_CACHE, 'Edit', undefined, 'src/x.ts')).toEqual({ events: [] })
})

test('a failure of the guard hook itself passes a write it had let through and refuses an agent\'s otherwise', () => {
  const cell = agentCell(cacheIn('code', 'implementer'))
  expect(caughtWrite(cell, 'Edit', 'a1', 'src/other.ts', { error: { kind: 'throw' }, called: true })).toBeUndefined()
  expect(caughtWrite(cell, 'Edit', 'a1', 'src/allowed/a.ts', { error: { kind: 'timeout' }, called: false })).toBe(GUARD_FAILED)
  expect(caughtWrite(cell, 'Edit', undefined, 'src/x.ts', { error: { kind: 'throw' }, called: false })).toBeUndefined()
  expect(cell.get().pending).toEqual([])
})
