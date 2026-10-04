import type { EventBody } from './events.ts'
import type { Board, Role, TaskSource, TaskStatus } from './types.ts'
import { ROLES, TASK_STATUSES, agentTypeOf } from './types.ts'

export const MAX_COMMENT = 4_000

export type Outcome = { readonly ok: true; readonly events: readonly EventBody[] } | { readonly ok: false; readonly error: string }

const ok = (...events: EventBody[]): Outcome => ({ ok: true, events })
const failed = (error: string): Outcome => ({ ok: false, error })

const MOVABLE: Readonly<Record<TaskSource, readonly TaskStatus[]>> = {
  openspec: ['ready', 'blocked'],
  native: ['backlog', 'ready', 'running', 'blocked', 'done'],
  board: ['backlog', 'ready', 'running', 'blocked', 'done'],
}

/** An openspec task in these statuses has a phase in flight; moving it would race the pipeline. */
const IN_PIPELINE: readonly TaskStatus[] = ['running', 'review']

export function createTask(board: Board, change: string, title: string, section?: string, description?: string): Outcome {
  if (board.changeId !== null && board.changeId !== change) return failed(`change ${change} is not loaded (the board shows ${board.changeId})`)
  const count = Object.values(board.tasks).filter(task => task.source === 'board').length
  return ok({ type: 'TaskCreated', task: { id: `b${count + 1}`, title, source: 'board', section: section ?? 'Board', description: description ?? title } })
}

export function addComment(board: Board, taskId: string, author: string, text: string, at: number): Outcome {
  const task = board.tasks[taskId]
  if (task === undefined) return failed(`unknown task id: ${taskId}`)
  const trimmed = text.trim()
  if (trimmed === '') return failed('comment is empty')
  if (trimmed.length > MAX_COMMENT) return failed(`comment is longer than ${MAX_COMMENT} characters`)
  return ok({ type: 'CommentAdded', taskId, comment: { id: `${taskId}#${task.comments.length + 1}-${at}`, author, text: trimmed } })
}

export function toggleBlock(board: Board, taskId: string): Outcome {
  const task = board.tasks[taskId]
  if (task === undefined) return failed(`unknown task id: ${taskId}`)
  if (task.status === 'blocked') return ok({ type: 'TaskStatusChanged', taskId, from: 'blocked', to: 'ready', reason: 'unblocked by user' })
  if (task.status === 'ready' || task.status === 'backlog') {
    return ok({ type: 'TaskStatusChanged', taskId, from: task.status, to: 'blocked', reason: 'blocked by user' })
  }
  return failed(`task ${taskId} is ${task.status}; only ready or blocked tasks can be blocked or unblocked`)
}

export function raisePriority(board: Board, taskId: string): Outcome {
  const task = board.tasks[taskId]
  return task === undefined ? failed(`unknown task id: ${taskId}`) : ok({ type: 'TaskUpdated', taskId, patch: { priority: task.priority + 1 } })
}

export function moveTask(board: Board, taskId: string, to: string): Outcome {
  const task = board.tasks[taskId]
  if (task === undefined) return failed(`unknown task id: ${taskId}`)
  if (!(TASK_STATUSES as readonly string[]).includes(to)) return failed(`unknown status: ${to}`)
  const status = to as TaskStatus
  if (task.source === 'openspec' && IN_PIPELINE.includes(task.status)) {
    return failed(`task ${taskId} is ${task.status}; the pipeline owns it until its phase ends`)
  }
  if (!MOVABLE[task.source].includes(status)) {
    return failed(task.source === 'openspec'
      ? 'an openspec task can only move to ready or blocked; done comes from the pipeline'
      : `a ${task.source} task cannot move to ${status}`)
  }
  return status === task.status ? ok() : ok({ type: 'TaskStatusChanged', taskId, from: task.status, to: status, reason: 'moved on the board' })
}

export function assignTask(board: Board, taskId: string, agent: string): Outcome {
  if (board.tasks[taskId] === undefined) return failed(`unknown task id: ${taskId}`)
  if (!(ROLES as readonly string[]).includes(agent)) return failed(`unknown agent: ${agent}`)
  return ok({ type: 'TaskUpdated', taskId, patch: { assignee: agentTypeOf(agent as Role) } })
}
