import type { EventBody } from '../domain/events.ts'
import { runOf, taskOfAgent } from '../domain/project.ts'
import type { Board } from '../domain/types.ts'
import { emitAgentStop } from './bus.ts'
import type { Io } from './io.ts'
import { append, readBoard } from './log-store.ts'

// Engine capture. The hooks that call these handlers live in register.tsx
// (one unmatched hook per event); each handler records what an engine event
// says about a pipeline agent and nothing about other agents.

export function activityFor(board: Board, agentId: string, tool?: string, tokens?: number): EventBody[] {
  const task = taskOfAgent(board, agentId)
  const run = task === undefined ? undefined : runOf(task, agentId)
  if (run === undefined || run.endedAt !== undefined) return []
  return [{ type: 'AgentActivity', agentId, ...(tool === undefined ? {} : { tool }), ...(tokens === undefined ? {} : { tokens }) }]
}

export async function touch(io: Io, agentId: string, tool?: string, tokens?: number): Promise<void> {
  await append(io, activityFor(await readBoard(io), agentId, tool, tokens))
}

export interface SubagentStopInput {
  readonly agentId: string
  readonly transcriptPath?: string
  readonly answer?: string
  readonly effort?: string
}

export async function captureStop(io: Io, stop: SubagentStopInput): Promise<void> {
  if (taskOfAgent(await readBoard(io), stop.agentId) === undefined) return
  const { agentId, transcriptPath, effort, answer } = stop
  await append(io, [{ type: 'AgentStopped', agentId, transcriptPath, ...(effort === undefined ? {} : { effort }) }])
  await emitAgentStop(io, { agentId, answer, transcriptPath, effort })
}

export async function captureTokens(io: Io, agentId: string | undefined, usage: { readonly input_tokens?: number; readonly output_tokens?: number } | undefined): Promise<void> {
  const tokens = (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0)
  if (agentId !== undefined && tokens > 0) await touch(io, agentId, undefined, tokens)
}
