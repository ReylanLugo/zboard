import { expect, test } from 'claude-code/testing'

import type { EventBody } from '../domain/events.ts'
import { project, runOf, taskOfAgent } from '../domain/project.ts'
import { evs, loaded, parsed } from '../testing/factories.ts'
import { installWorld, worldIo } from '../testing/world.ts'
import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'
import type { PlanBoard } from '../plan/types.ts'
import { EMPTY_AGENT_CACHE, PLAN_ROLES_CAP, agentCell, flushPending, withBoard, withPending, withPlanAgents } from './agent-cache.ts'
import { readBoard } from './log-store.ts'

const started: EventBody = { type: 'PhaseStarted', taskId: '1.1', phase: 'code', attempt: 1, agentId: 'a1', agentType: 'zboard:implementer', role: 'implementer', model: 'm', baseline: {} }
const board = () => project(evs([loaded(parsed('1.1')), started]))
const denied: EventBody = { type: 'GuardDenied', taskId: '1.1', agentId: 'a1', path: 'x' }
const deniesOf = (cache: { readonly board?: ReturnType<typeof board> }): number | undefined => {
  const task = cache.board === undefined ? undefined : taskOfAgent(cache.board, 'a1')
  return task === undefined ? undefined : runOf(task, 'a1')?.denies
}
const planWith = (agents: readonly { agentId: string; role: string }[]): PlanBoard =>
  ({ changes: Object.fromEntries(agents.map(agent => [agent.agentId, { activeAgent: agent }])) }) as unknown as PlanBoard

test('pending events stay applied when a fresh board replaces the cached one', () => {
  const queued = withPending(withBoard(EMPTY_AGENT_CACHE, board()), [denied])
  expect(deniesOf(queued)).toBe(1)
  expect(deniesOf(withBoard(queued, board()))).toBe(1)
  expect(withPending(EMPTY_AGENT_CACHE, [denied]).board).toBeUndefined()
})

test('every plan agent seen running is remembered with its role, newest kept up to the cap', () => {
  const one = withPlanAgents(EMPTY_AGENT_CACHE, planWith([{ agentId: 'p1', role: 'drafter' }]))
  expect([...one.planRoles]).toEqual([['p1', 'drafter']])
  expect(withPlanAgents(one, planWith([]))).toBe(one)
  const many = Array.from({ length: PLAN_ROLES_CAP + 1 }, (_, index) => ({ agentId: `q${index}`, role: 'critic' }))
  const full = withPlanAgents(one, planWith(many))
  expect(full.planRoles.size).toBe(PLAN_ROLES_CAP)
  expect(full.planRoles.has('p1')).toBe(false)
})

test('flushing appends the pending events once and empties the queue', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async (_$, on) => {
  const io = worldIo(installWorld(on))
  const cell = agentCell(withPending(EMPTY_AGENT_CACHE, [{ type: 'RunControl', running: true, paused: false }]))
  await flushPending(io, cell)
  await flushPending(io, cell)
  expect(cell.get().pending).toEqual([])
  expect((await readBoard(io)).running).toBe(true)
})
