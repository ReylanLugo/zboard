import type { Io } from './io.ts'

import { commitMessage, commitTask } from '../adapters/git.ts'
import { flipTask } from '../adapters/openspec.ts'
import type { Task } from '../domain/types.ts'
import { append, readBoard } from './log-store.ts'

const SHA_LENGTH = 7

async function needsDecision(io: Io, task: Task, reason: string): Promise<void> {
  await append(io, [{ type: 'TaskStatusChanged', taskId: task.id, from: task.status, to: 'needs_decision', reason }])
}

export async function finishIfComplete(io: Io): Promise<void> {
  const board = await readBoard(io)
  const openspec = board.order.map(id => board.tasks[id]).filter(task => task?.source === 'openspec')
  const inScope = board.scope === undefined ? openspec : openspec.filter(task => task?.id === board.scope)
  if (inScope.length > 0 && inScope.every(task => task?.status === 'done')) {
    await append(io, [{ type: 'RunControl', running: false, paused: false }])
  }
}

export async function closeTask(io: Io, task: Task): Promise<void> {
  const paths = [...task.touched]
  if (paths.length === 0) return needsDecision(io, task, 'nothing to commit: the task touched no files')
  const committed = await commitTask(io, {
    cwd: await io.session.root(),
    paths,
    message: commitMessage(task.changeId, task.id, task.title),
  })
  if (!committed.ok) return needsDecision(io, task, committed.reason)
  const sha = committed.sha.slice(0, SHA_LENGTH)
  if (task.source === 'openspec' && task.line !== undefined) {
    const flipped = await flipTask(io, task.changeId, task.id, task.line)
    if (!flipped.ok) return needsDecision(io, task, `committed ${sha} but tasks.md was not updated: ${flipped.reason}`)
  }
  await append(io, [{ type: 'TaskStatusChanged', taskId: task.id, from: task.status, to: 'done', reason: `committed ${sha}` }])
  await finishIfComplete(io)
}
