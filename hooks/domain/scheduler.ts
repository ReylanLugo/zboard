import { activeRun } from './project.ts'
import type { Board, Task, TaskStatus } from './types.ts'
import { WRITE_PHASES } from './types.ts'

export interface SchedulerOptions {
  readonly limit: number
  readonly scope?: string
}

export interface Conflict {
  readonly holder: string
  readonly file: string
}

const ACTIVE: readonly TaskStatus[] = ['running', 'review']

const tasksOf = (board: Board): Task[] =>
  board.order.map(id => board.tasks[id]).filter((task): task is Task => task !== undefined)

export const runningCount = (board: Board): number =>
  tasksOf(board).filter(task => task.source === 'openspec' && ACTIVE.includes(task.status)).length

const isStartable = (board: Board, task: Task, scope: string | undefined): boolean =>
  task.source === 'openspec' &&
  task.status === 'ready' &&
  task.pending === undefined &&
  (scope === undefined || task.id === scope) &&
  task.dependsOn.every(dependency => board.tasks[dependency]?.status === 'done')

export function runnable(board: Board, opts: SchedulerOptions): string[] {
  if (!board.running || board.paused) return []
  const free = opts.limit - runningCount(board)
  if (free <= 0) return []
  return tasksOf(board)
    .filter(task => isStartable(board, task, opts.scope))
    .sort((a, b) => b.priority - a.priority || board.order.indexOf(a.id) - board.order.indexOf(b.id))
    .slice(0, free)
    .map(task => task.id)
}

export function writeConflict(board: Board, taskId: string): Conflict | undefined {
  const task = board.tasks[taskId]
  if (task === undefined) return undefined
  for (const other of tasksOf(board)) {
    const run = other.id === taskId ? undefined : activeRun(other)
    if (run === undefined || !WRITE_PHASES.includes(run.phase)) continue
    const file = task.allowedFiles.find(path => other.allowedFiles.includes(path))
    if (file !== undefined) return { holder: other.id, file }
  }
  return undefined
}

export const waitReason = (conflict: Conflict): string => `waits ${conflict.holder} for ${conflict.file}`
