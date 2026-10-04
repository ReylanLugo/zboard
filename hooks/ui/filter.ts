import type { Board, Task } from '../domain/types.ts'
import { ROLES, TASK_STATUSES } from '../domain/types.ts'
import type { Filter } from '../runtime/ui-types.ts'

const tasksOf = (board: Board): Task[] =>
  board.order.map(id => board.tasks[id]).filter((task): task is Task => task !== undefined)

export function matches(task: Task, filter: Filter): boolean {
  switch (filter.kind) {
    case 'none':
      return true
    case 'status':
      return task.status === filter.value
    case 'agent':
      return task.agents.some(run => run.role === filter.value && run.endedAt === undefined)
    case 'section':
      return task.section === filter.value
  }
}

export const visibleTasks = (board: Board, filter: Filter): Task[] => tasksOf(board).filter(task => matches(task, filter))

export function filterChoices(board: Board): Filter[] {
  const sections = [...new Set(tasksOf(board).map(task => task.section).filter(section => section !== ''))]
  return [
    { kind: 'none' },
    ...TASK_STATUSES.map(value => ({ kind: 'status' as const, value })),
    ...ROLES.map(value => ({ kind: 'agent' as const, value })),
    ...sections.map(value => ({ kind: 'section' as const, value })),
  ]
}

export function filterLabel(filter: Filter): string {
  return filter.kind === 'none' ? 'all' : `${filter.kind}: ${filter.value}`
}

export function nextFilter(board: Board, current: Filter): Filter {
  const choices = filterChoices(board)
  const index = choices.findIndex(choice => filterLabel(choice) === filterLabel(current))
  return choices[(index + 1) % choices.length] ?? { kind: 'none' }
}
