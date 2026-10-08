import type { SessionMessage } from 'claude-code'

import { runOf, taskOfAgent } from '../domain/project.ts'
import { changeOfAgent } from '../plan/plan-project.ts'
import type { Io } from './io.ts'
import { message, readBoard } from './log-store.ts'
import { readPlan } from './plan-store.ts'

// A background subagent reports through the engine's SubagentHandback tool and
// then ends with no text. The engine runs a zboard-spawned agent's tool calls
// without zboard's hooks (re-entry: zboard's own spawn lent them), so zboard
// never sees that call; it reads the report from the agent's messages when the
// agent's run completes.

/** The engine tool a background subagent ends its run with: `{ message }`. */
export const HANDBACK_TOOL = 'SubagentHandback'

/** The role of a running zboard agent (a board task's open run or a change's active plan agent). */
export async function roleOfAgent(io: Io, agentId: string): Promise<string | undefined> {
  const task = taskOfAgent(await readBoard(io), agentId)
  const run = task === undefined ? undefined : runOf(task, agentId)
  if (run !== undefined && run.endedAt === undefined) return run.role
  return changeOfAgent(await readPlan(io), agentId)?.activeAgent?.role
}

export const nonBlank = (text: string | undefined): string | undefined =>
  text === undefined || text.trim() === '' ? undefined : text

const handbackIn = (row: SessionMessage): string | undefined => {
  const use = [...(row.toolUses ?? [])].reverse().find(entry => entry.tool === HANDBACK_TOOL && typeof entry.input?.message === 'string')
  return use === undefined ? undefined : String(use.input.message)
}

/** The last report in an agent's messages; none when no row holds a SubagentHandback call. */
export const handbackFrom = (rows: readonly SessionMessage[]): string | undefined =>
  [...rows].reverse().map(handbackIn).find(found => found !== undefined)

/**
 * The last report a running zboard agent handed back, read from its conversation.
 * Unreadable messages read as no report.
 */
export async function reportFromMessages(io: Io, agentId: string): Promise<string | undefined> {
  if ((await roleOfAgent(io, agentId)) === undefined) return undefined
  try {
    const rows = await io.session.messages({ agentId })
    return Array.isArray(rows) ? handbackFrom(rows) : undefined
  } catch (error) {
    io.ui.debug(`zboard: the messages of ${agentId} were unreadable: ${message(error)}`)
    return undefined
  }
}

/** An agent's answer at its completion: its final text, else the report it handed back. */
export async function stopAnswer(io: Io, agentId: string, text: string | undefined): Promise<string | undefined> {
  return nonBlank(text) ?? (await reportFromMessages(io, agentId))
}
