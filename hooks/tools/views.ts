import type { AgentRun, Board, Task } from '../domain/types.ts'

const withoutBaseline = ({ baseline: _baseline, ...run }: AgentRun) => run

const taskSummary = (task: Task) => ({
  id: task.id,
  title: task.title,
  status: task.status,
  phase: task.phase,
  loop: task.loop,
  source: task.source,
  pending: task.pending?.phase ?? null,
  statusReason: task.statusReason ?? null,
  waitReason: task.waitReason ?? null,
  agents: task.agents
    .filter(run => run.endedAt === undefined)
    .map(run => ({ agentId: run.agentId, agentType: run.agentType, model: run.model, effort: run.effort ?? null, currentTool: run.currentTool ?? null })),
})

export const statusView = (board: Board, events: number) => ({
  change: board.changeId,
  running: board.running,
  paused: board.paused,
  scope: board.scope ?? null,
  events,
  mirrorPending: board.mirrorPending,
  warnings: board.configWarnings,
  errors: board.errors.map(error => ({ hook: error.hook, taskId: error.taskId ?? null, message: error.message })),
  tasks: board.order.map(id => board.tasks[id]).filter((task): task is Task => task !== undefined).map(taskSummary),
})

export type StatusView = ReturnType<typeof statusView>

export const taskView = (task: Task) => ({ ...task, agents: task.agents.map(withoutBaseline) })

export const agentView = (task: Task, run: AgentRun) => ({
  ...withoutBaseline(run),
  taskId: task.id,
  transcriptPath: run.transcriptPath ?? null,
})
