import { expect, test } from 'claude-code/testing'

import type { EventBody } from '../domain/events.ts'
import { loaded, parsed } from '../testing/factories.ts'
import { installWorld, worldIo } from '../testing/world.ts'
import { setupDemo } from '../testing/zboard.ts'
import { append, readBoard } from './log-store.ts'
import { proceed, setPending } from './orchestrator.ts'

const ctx = { options: {} }

const blockedRun: readonly EventBody[] = [
  loaded(parsed('1.1')),
  { type: 'RunControl', running: true, paused: false },
  { type: 'TaskStatusChanged', taskId: '1.1', from: 'ready', to: 'blocked', reason: 'moved on the board' },
]

test('a pending phase of a task that is no longer in the pipeline is never launched', async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  const io = worldIo(w)
  await append(io, blockedRun, 'demo')
  await setPending(io, ctx, '1.1', { phase: 'code', attempt: 1 })
  expect(w.spawns).toEqual([])
  const board = await readBoard(io)
  expect(board.errors).toEqual([])
  expect(board.tasks['1.1']?.status).toBe('blocked')
})

test('the next action re-reads the status: a task moved meanwhile is neither advanced nor closed', async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  const io = worldIo(w)
  await append(io, blockedRun, 'demo')
  await proceed(io, ctx, '1.1', { kind: 'advance', phase: 'review' })
  await proceed(io, ctx, '1.1', { kind: 'done' })
  const task = (await readBoard(io)).tasks['1.1']
  expect(task).toMatchObject({ status: 'blocked', statusReason: 'moved on the board' })
  expect(task?.pending).toBeUndefined()
  expect(w.spawns).toEqual([])
  expect(w.runs.filter(argv => argv[1] === 'commit')).toEqual([])
})
