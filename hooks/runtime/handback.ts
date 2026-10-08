import { runOf, taskOfAgent } from '../domain/project.ts'
import { changeOfAgent } from '../plan/plan-project.ts'
import type { Handback, Io } from './io.ts'
import { readBoard } from './log-store.ts'
import { readPlan } from './plan-store.ts'

// A background subagent reports through the engine's SubagentHandback tool and
// then stops with no text, so its SubagentStop carries no answer. zboard keeps
// the report of each of its own agents here (host state, so a reload mid-run
// keeps it) until that agent's stop takes it.

/** The engine tool a background subagent ends its run with: `{ message }`. */
export const HANDBACK_TOOL = 'SubagentHandback'

/** At most this many reports wait for their agent's stop; the oldest go first. */
export const HANDBACK_CAP = 16

export const handbackNote = (role: string, agentId: string): string =>
  `zboard captured this report (${role}, agent ${agentId}); it is shown in the zboard pane.`

export const withoutHandback = (list: readonly Handback[], agentId: string): readonly Handback[] =>
  list.filter(entry => entry.agentId !== agentId)

export const withHandback = (list: readonly Handback[], entry: Handback): readonly Handback[] =>
  [...withoutHandback(list, entry.agentId), entry].slice(-HANDBACK_CAP)

/** The role of a running zboard agent (a board task's open run or a change's active plan agent). */
export async function roleOfAgent(io: Io, agentId: string): Promise<string | undefined> {
  const task = taskOfAgent(await readBoard(io), agentId)
  const run = task === undefined ? undefined : runOf(task, agentId)
  if (run !== undefined && run.endedAt === undefined) return run.role
  return changeOfAgent(await readPlan(io), agentId)?.activeAgent?.role
}

/** Keeps a zboard agent's report; resolves the note the main session gets instead, or undefined for other agents. */
export async function captureHandback(io: Io, agentId: string, message: unknown): Promise<string | undefined> {
  if (typeof message !== 'string') return undefined
  const role = await roleOfAgent(io, agentId)
  if (role === undefined) return undefined
  await io.state.handbacks.update(current => withHandback(current, { agentId, message }))
  return handbackNote(role, agentId)
}

/** Removes and returns the report kept for an agent. */
export async function takeHandback(io: Io, agentId: string): Promise<string | undefined> {
  const found = (await io.state.handbacks.read()).find(entry => entry.agentId === agentId)
  if (found === undefined) return undefined
  await io.state.handbacks.update(current => withoutHandback(current, agentId))
  return found.message
}

const nonBlank = (text: string | undefined): string | undefined =>
  text === undefined || text.trim() === '' ? undefined : text

/** An agent's answer at its stop: its final text, else the report it handed back (taken either way). */
export async function stopAnswer(io: Io, agentId: string, text: string | undefined): Promise<string | undefined> {
  const kept = await takeHandback(io, agentId)
  return nonBlank(text) ?? kept
}
