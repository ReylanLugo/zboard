import { formatComment, undelivered } from '../domain/comments.ts'
import type { EventBody } from '../domain/events.ts'
import { runOf, taskOfAgent } from '../domain/project.ts'
import type { Board } from '../domain/types.ts'

export function noteFor(board: Board, agentId: string): { note: string; events: readonly EventBody[] } | undefined {
  const task = taskOfAgent(board, agentId)
  const run = task === undefined ? undefined : runOf(task, agentId)
  if (task === undefined || run === undefined || run.endedAt !== undefined) return undefined
  const pending = undelivered(task)
  if (pending.length === 0) return undefined
  return {
    note: pending.map(formatComment).join('\n'),
    events: pending.map(comment => ({ type: 'CommentDelivered' as const, taskId: task.id, commentId: comment.id, to: run.agentType })),
  }
}

