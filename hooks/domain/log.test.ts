import { expect, test } from 'claude-code/testing'

import type { EventBody } from './events.ts'
import { parsed } from '../testing/factories.ts'
import { EMPTY_LOG, SNAPSHOT_THRESHOLD, appendEvents, boardOf } from './log.ts'
import { project } from './project.ts'

const LABELS = Array.from({ length: 60 }, (_, index) => `${Math.floor(index / 10) + 1}.${(index % 10) + 1}`)

function generator(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
    return state / 2_147_483_648
  }
}

function generate(count: number): EventBody[] {
  const random = generator(42)
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T
  const bodies: EventBody[] = [{ type: 'ChangeLoaded', tasks: LABELS.map(label => parsed(label)) }]
  for (let index = 1; index < count; index += 1) {
    const taskId = pick(LABELS)
    const agentId = `a${Math.floor(random() * 40)}`
    const options: EventBody[] = [
      { type: 'TaskUpdated', taskId, patch: { priority: Math.floor(random() * 5) } },
      { type: 'TaskStatusChanged', taskId, from: 'ready', to: pick(['ready', 'running', 'blocked', 'needs_decision'] as const) },
      { type: 'PhaseStarted', taskId, phase: 'code', attempt: 1, agentId, agentType: 'zboard:implementer', role: 'implementer', model: 'claude-sonnet-5-5', baseline: {} },
      { type: 'AgentActivity', agentId, tool: 'Edit', tokens: 100 },
      { type: 'AgentStopped', agentId, transcriptPath: `/t/${agentId}` },
      { type: 'PhaseCompleted', taskId, phase: 'code', attempt: 1, gate: pick(['pass', 'fail'] as const), touched: ['src/a.ts'] },
      { type: 'CommentAdded', taskId, comment: { id: `c${index}`, author: 'user', text: 'note' } },
      { type: 'ModError', hook: 'capture', message: `boom ${index}` },
    ]
    bodies.push(pick(options))
  }
  return bodies
}

test('appendEvents numbers events from the last seq and stamps time and change', () => {
  const first = appendEvents(EMPTY_LOG, [{ type: 'MirrorState', pending: true }], 5, 'demo')
  const second = appendEvents(first.state, [{ type: 'MirrorState', pending: false }], 6, 'demo')
  expect(second.events[0]).toEqual({ type: 'MirrorState', pending: false, seq: 2, at: 6, changeId: 'demo' })
  expect(second.state.seq).toBe(2)
})

test('compaction folds the tail into a snapshot at the threshold', () => {
  const bodies = generate(10)
  const { state } = appendEvents(EMPTY_LOG, bodies, 1, 'demo', 10)
  expect(state.tail).toHaveLength(0)
  expect(state.snapshot).not.toBeNull()
  expect(state.seq).toBe(10)
})

test('project(snapshot, tail) equals project(full log) for 1200 generated events', () => {
  const bodies = generate(1_200)
  let compacted = EMPTY_LOG
  const all = []
  for (let index = 0; index < bodies.length; index += 7) {
    const appended = appendEvents(compacted, bodies.slice(index, index + 7), 1_000 + index, 'demo')
    compacted = appended.state
    all.push(...appended.events)
  }
  expect(compacted.snapshot).not.toBeNull()
  expect(boardOf(compacted)).toEqual(project(all))
})

test('a 500-event log of 60 tasks stays under 1 MiB of JSON (snapshot threshold spike)', () => {
  const { state } = appendEvents(EMPTY_LOG, generate(SNAPSHOT_THRESHOLD - 1), 1, 'demo')
  expect(state.snapshot).toBeNull()
  expect(JSON.stringify(state).length).toBeLessThan(1_048_576)
})
