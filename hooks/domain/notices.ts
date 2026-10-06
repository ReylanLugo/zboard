import type { Board, Task } from './types.ts'

const openspecTasks = (board: Board): Task[] =>
  board.order.map(id => board.tasks[id]).filter((task): task is Task => task?.source === 'openspec')

const isComplete = (board: Board): boolean => {
  const tasks = openspecTasks(board)
  return tasks.length > 0 && tasks.every(task => task.status === 'done')
}

/** Which runner the project uses: ptest names its own full gate; any other runner gets neutral wording. */
export type RunnerKind = 'ptest' | 'custom'

const FULL_GATE: Readonly<Record<RunnerKind, string>> = {
  ptest: 'The integrated `ptest --full` gate is still required before handoff.',
  custom: 'The integrated full-suite gate is still required before handoff: run the project\'s full test suite.',
}

export function noticesBetween(before: Board, after: Board, runner: RunnerKind = 'ptest'): string[] {
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
    `zboard: change ${after.changeId} is complete (${count}/${count} tasks done). ${FULL_GATE[runner]}`,
  ]
}
