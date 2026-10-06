import type { Io } from '../runtime/io.ts'

import type { Outcome } from '../domain/interactions.ts'
import { addComment, assignTask, createTask, moveTask } from '../domain/interactions.ts'
import type { Board } from '../domain/types.ts'
import { ROLES, TASK_STATUSES } from '../domain/types.ts'
import { changeOfAgent } from '../plan/plan-project.ts'
import { append, readBoard } from '../runtime/log-store.ts'
import { readPlan } from '../runtime/plan-store.ts'
import type { ToolAnswer } from './board-read.ts'
import { invalid, text } from './validate.ts'

const TITLE_MAX = 200

async function decide(io: Io, choose: (board: Board, at: number) => Outcome, changeId?: string) {
  const outcome = choose(await readBoard(io), await io.clock.now())
  if (!outcome.ok) return { deny: `zboard: ${outcome.error}` }
  await append(io, outcome.events, changeId)
  return { result: JSON.stringify({ ok: true, events: outcome.events.map(event => event.type) }) }
}

export async function registerWriteTools(io: Io): Promise<void> {
  const object = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required })
  await io.tool.register({
    name: 'board_create_task',
    description: 'zboard: add a task to the board of the given OpenSpec change (tracked, not run by the pipeline).',
    inputSchema: object({ change: { type: 'string' }, title: { type: 'string' }, section: { type: 'string' }, description: { type: 'string' } }, ['change', 'title']),
  })
  await io.tool.register({
    name: 'board_comment',
    description: 'zboard: comment on a task; the comment is delivered to the task agent as untrusted data.',
    inputSchema: object({ taskId: { type: 'string' }, text: { type: 'string' } }, ['taskId', 'text']),
  })
  await io.tool.register({
    name: 'board_move',
    description: 'zboard: move a task to another status (openspec tasks: ready or blocked only).',
    inputSchema: object({ taskId: { type: 'string' }, status: { type: 'string', enum: [...TASK_STATUSES] } }, ['taskId', 'status']),
  })
  await io.tool.register({
    name: 'board_assign',
    description: 'zboard: record which zboard agent role a board or native task belongs to.',
    inputSchema: object({ taskId: { type: 'string' }, agent: { type: 'string', enum: [...ROLES] } }, ['taskId', 'agent']),
  })
}

/** A board tool call's input: the tool's own arguments plus the calling agent, if any. */
export type ToolInput = Readonly<Record<string, unknown>> & { readonly agentId?: string }

/** Plan agents only read and answer (D4): a board write from an active plan agent is refused. */
async function planAgentDeny(io: Io, e: ToolInput, tool: string): Promise<ToolAnswer | undefined> {
  if (e.agentId === undefined || changeOfAgent(await readPlan(io), e.agentId) === undefined) return undefined
  return { deny: `zboard: plan agents cannot change the board; ${tool} was refused.` }
}

export async function createTaskTool(io: Io, e: ToolInput): Promise<ToolAnswer> {
  const refused = await planAgentDeny(io, e, 'board_create_task')
  if (refused !== undefined) return refused
  const change = text(e, 'change')
  const title = text(e, 'title', TITLE_MAX)
  if (change === undefined) return invalid('change')
  if (title === undefined) return invalid('title')
  return decide(io, board => createTask(board, change, title, text(e, 'section'), text(e, 'description')), change)
}

export async function commentTool(io: Io, e: ToolInput): Promise<ToolAnswer> {
  const refused = await planAgentDeny(io, e, 'board_comment')
  if (refused !== undefined) return refused
  const taskId = text(e, 'taskId')
  const body = typeof e.text === 'string' ? e.text : undefined
  if (taskId === undefined) return invalid('taskId')
  if (body === undefined) return invalid('text')
  const author = e.agentId === undefined ? 'main' : `agent:${e.agentId}`
  return decide(io, (board, at) => addComment(board, taskId, author, body, at))
}

export async function moveTool(io: Io, e: ToolInput): Promise<ToolAnswer> {
  const refused = await planAgentDeny(io, e, 'board_move')
  if (refused !== undefined) return refused
  const taskId = text(e, 'taskId')
  const status = text(e, 'status')
  if (taskId === undefined) return invalid('taskId')
  if (status === undefined) return invalid('status')
  return decide(io, board => moveTask(board, taskId, status))
}

export async function assignTool(io: Io, e: ToolInput): Promise<ToolAnswer> {
  const refused = await planAgentDeny(io, e, 'board_assign')
  if (refused !== undefined) return refused
  const taskId = text(e, 'taskId')
  const agent = text(e, 'agent')
  if (taskId === undefined) return invalid('taskId')
  if (agent === undefined) return invalid('agent')
  return decide(io, board => assignTask(board, taskId, agent))
}
