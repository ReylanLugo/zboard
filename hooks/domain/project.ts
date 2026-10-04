import type { DomainEvent, EventOf, ParsedTask, TaskPatch } from './events.ts'
import type { AgentRun, Board, Task } from './types.ts'
import { emptyBoard, newTask } from './types.ts'

const MAX_ERRORS = 50
const CLEARS_PENDING = new Set(['needs_decision', 'blocked', 'done', 'ready'])

const withTask = (board: Board, task: Task): Board => ({
  ...board,
  tasks: { ...board.tasks, [task.id]: task },
  order: board.order.includes(task.id) ? board.order : [...board.order, task.id],
})

const updateTask = (board: Board, id: string, change: (task: Task) => Task): Board => {
  const task = board.tasks[id]
  return task === undefined ? board : withTask(board, change(task))
}

const withoutTask = (board: Board, id: string): Board => ({
  ...board,
  tasks: Object.fromEntries(Object.entries(board.tasks).filter(([key]) => key !== id)),
  order: board.order.filter(key => key !== id),
})

function mergeParsed(existing: Task | undefined, parsed: ParsedTask, changeId: string): Task {
  const fields = {
    title: parsed.title,
    section: parsed.section,
    description: parsed.description,
    line: parsed.line,
    blockedText: parsed.blockedText,
    dependsOn: parsed.dependsOn,
  }
  if (existing === undefined) {
    return newTask({ id: parsed.label, changeId, source: 'openspec', status: parsed.done ? 'done' : 'ready', ...fields })
  }
  const status = parsed.done ? 'done' : existing.status === 'done' ? 'ready' : existing.status
  return { ...existing, ...fields, status }
}

function reconcile(board: Board, e: EventOf<'ChangeLoaded'>): Board {
  // A board with no change yet keeps its native/board tasks when the first change loads.
  const base = board.changeId === e.changeId || board.changeId === null ? board : emptyBoard(e.changeId)
  const labels = new Set(e.tasks.map(task => task.label))
  const others = base.order.filter(id => base.tasks[id]?.source !== 'openspec' && !labels.has(id))
  const merged = e.tasks.map(parsed => mergeParsed(base.tasks[parsed.label], parsed, e.changeId))
  const kept = others.map(id => base.tasks[id]).filter((task): task is Task => task !== undefined)
  return {
    ...base,
    changeId: e.changeId,
    tasks: Object.fromEntries([...merged, ...kept].map(task => [task.id, task])),
    order: [...merged.map(task => task.id), ...others],
  }
}

function patchTask(task: Task, patch: TaskPatch): Task {
  const { pending, waitReason, overrides, ...rest } = patch
  const base: Task = { ...task, ...rest, overrides: { ...task.overrides, ...overrides } }
  const waited = waitReason === undefined ? base : { ...base, waitReason: waitReason === '' ? undefined : waitReason }
  if (pending === undefined) return waited
  return { ...waited, pending: pending === null ? undefined : pending }
}

function restore(board: Board, e: EventOf<'TaskRestored'>): Board {
  const current = board.tasks[e.task.id]
  if (current === undefined) return e.task.source === 'openspec' ? board : withTask(board, e.task)
  return withTask(board, {
    ...e.task,
    title: current.title,
    section: current.section,
    description: current.description,
    line: current.line,
    blockedText: current.blockedText,
    dependsOn: current.dependsOn,
    status: current.status === 'done' ? 'done' : e.task.status,
  })
}

function changeStatus(task: Task, e: EventOf<'TaskStatusChanged'>): Task {
  return {
    ...task,
    status: e.to,
    statusReason: e.reason,
    pending: CLEARS_PENDING.has(e.to) ? undefined : task.pending,
    waitReason: CLEARS_PENDING.has(e.to) ? undefined : task.waitReason,
  }
}

function applyTaskEvent(board: Board, e: DomainEvent): Board {
  switch (e.type) {
    case 'TaskCreated':
      return board.tasks[e.task.id] !== undefined
        ? board
        : withTask(board, newTask({ ...e.task, changeId: e.changeId }))
    case 'TaskUpdated':
      return updateTask(board, e.taskId, task => patchTask(task, e.patch))
    case 'TaskRemoved':
      return withoutTask(board, e.taskId)
    case 'TaskStatusChanged':
      return updateTask(board, e.taskId, task => changeStatus(task, e))
    case 'CommentAdded':
      return updateTask(board, e.taskId, task => ({ ...task, comments: [...task.comments, { ...e.comment, at: e.at }] }))
    case 'CommentDelivered':
      return updateTask(board, e.taskId, task => ({
        ...task,
        comments: task.comments.map(comment => (comment.id === e.commentId ? { ...comment, deliveredTo: e.to } : comment)),
      }))
    default:
      return applyAgentEvent(board, e)
  }
}

/** Agent and phase events; extended in Task 2.2. */
function applyAgentEvent(board: Board, _e: DomainEvent): Board {
  return board
}

const isForeignTaskEvent = (board: Board, e: DomainEvent): boolean =>
  'taskId' in e && board.changeId !== null && e.changeId !== board.changeId

export function apply(board: Board, e: DomainEvent): Board {
  switch (e.type) {
    case 'ChangeLoaded':
      return reconcile(board, e)
    case 'TaskRestored':
      return restore(board, e)
    case 'RunControl':
      return { ...board, running: e.running, paused: e.paused, scope: e.scope }
    case 'MirrorState':
      return { ...board, mirrorPending: e.pending }
    case 'ConfigWarnings':
      return { ...board, configWarnings: e.warnings }
    case 'ModError':
      return { ...board, errors: [...board.errors, { hook: e.hook, taskId: e.taskId, message: e.message, at: e.at }].slice(-MAX_ERRORS) }
    default:
      return isForeignTaskEvent(board, e) ? board : applyTaskEvent(board, e)
  }
}

export const project = (events: readonly DomainEvent[], from: Board = emptyBoard(null)): Board =>
  events.reduce(apply, from)

export const taskOfAgent = (board: Board, agentId: string): Task | undefined =>
  board.order.map(id => board.tasks[id]).find(task => task?.agents.some(run => run.agentId === agentId))

export const runOf = (task: Task, agentId: string): AgentRun | undefined =>
  task.agents.find(run => run.agentId === agentId)

export const activeRun = (task: Task): AgentRun | undefined =>
  [...task.agents].reverse().find(run => run.endedAt === undefined)
