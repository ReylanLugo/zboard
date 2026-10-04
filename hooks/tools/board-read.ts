import { fetchTopic } from '../adapters/engram.ts'
import { runOf, taskOfAgent } from '../domain/project.ts'
import { PHASES } from '../domain/types.ts'
import type { Io } from '../runtime/io.ts'
import { getArtifact, readBoard, readLog } from '../runtime/log-store.ts'
import { agentView, statusView, taskView } from './views.ts'

/** What a zboard tool hook answers: a JSON result or a denial naming the problem. */
export type ToolAnswer = { readonly result: string } | { readonly deny: string }

const json = (value: unknown): ToolAnswer => ({ result: JSON.stringify(value, null, 2) })

export async function registerReadTools(io: Io): Promise<void> {
  await io.tool.register({
    name: 'board_status',
    description: 'zboard: every task of the active OpenSpec change with status, phase, loop and active agents. Read-only.',
    inputSchema: { type: 'object', properties: {} },
  })
  await io.tool.register({
    name: 'board_task',
    description: 'zboard: one task with its phases, gate results, runs and comments. Read-only.',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] },
  })
  await io.tool.register({
    name: 'board_artifact',
    description: 'zboard: the latest stored artifact of one phase of one task (truncated artifacts end with a marker and the transcript path). Read-only.',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string' }, phase: { type: 'string', enum: [...PHASES] } }, required: ['taskId', 'phase'] },
  })
  await io.tool.register({
    name: 'board_agent',
    description: 'zboard: one pipeline agent run with model, effort, tokens, outcome and transcript path. Read-only.',
    inputSchema: { type: 'object', properties: { agentId: { type: 'string' } }, required: ['agentId'] },
  })
}

export async function boardStatus(io: Io): Promise<ToolAnswer> {
  const log = await readLog(io)
  return json(statusView(await readBoard(io), log.seq))
}

export async function boardTask(io: Io, taskId: string): Promise<ToolAnswer> {
  const task = (await readBoard(io)).tasks[taskId]
  return task === undefined ? { deny: `unknown task id: ${taskId}` } : json(taskView(task))
}

export async function boardArtifact(io: Io, taskId: string, phase: string): Promise<ToolAnswer> {
  const board = await readBoard(io)
  const task = board.tasks[taskId]
  if (task === undefined) return { deny: `unknown task id: ${taskId}` }
  const record = [...task.phases].reverse().find(entry => entry.phase === phase && entry.artifactKey !== undefined)
  if (record?.artifactKey === undefined) return { deny: `task ${taskId} has no ${phase} artifact yet` }
  const text = (await getArtifact(io, record.artifactKey)) ?? (await fetchTopic(io, record.artifactKey))?.text
  if (text === undefined) return { deny: `the ${phase} artifact of ${taskId} is not available (${record.artifactKey})` }
  return json({ taskId, phase, attempt: record.attempt, gate: record.gate, key: record.artifactKey, text })
}

export async function boardAgent(io: Io, agentId: string): Promise<ToolAnswer> {
  const board = await readBoard(io)
  const task = taskOfAgent(board, agentId)
  const run = task === undefined ? undefined : runOf(task, agentId)
  return task === undefined || run === undefined ? { deny: `unknown agent id: ${agentId}` } : json(agentView(task, run))
}
