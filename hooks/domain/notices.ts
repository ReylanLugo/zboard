import type { Board, Task } from './types.ts'

const openspecTasks = (board: Board): Task[] =>
  board.order.map(id => board.tasks[id]).filter((task): task is Task => task?.source === 'openspec')

const isComplete = (board: Board): boolean => {
  const tasks = openspecTasks(board)
  return tasks.length > 0 && tasks.every(task => task.status === 'done')
}

export function noticesBetween(before: Board, after: Board): string[] {
  const decisions = after.order.flatMap(id => {
    const now = after.tasks[id]
    const was = before.tasks[id]
    if (now?.status !== 'needs_decision' || was?.status === 'needs_decision') return []
    return [`zboard: task ${id} "${now.title}" needs a decision — ${now.statusReason ?? 'no reason recorded'}`]
  })
  const completed = before.changeId === after.changeId && isComplete(after) && !isComplete(before)
  if (!completed) return decisions
  const count = openspecTasks(after).length
  return [
    ...decisions,
    `zboard: change ${after.changeId} is complete (${count}/${count} tasks done). The integrated \`ptest --full\` gate is still required before handoff.`,
  ]
}
