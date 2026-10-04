import type { Io } from './io.ts'

import { activeTopic, fetchTopic, indexTopic, mirror, projectOf, taskTopic } from '../adapters/engram.ts'
import { loadChange } from '../adapters/openspec.ts'
import type { EventBody } from '../domain/events.ts'
import { isRecord, stringArray } from '../domain/json.ts'
import { activeRun, taskOfAgent } from '../domain/project.ts'
import type { AgentRun, Board, Task } from '../domain/types.ts'
import type { Ctx } from './ctx.ts'
import { PANE_ID } from './ctx.ts'
import { append, onAppend, readBoard } from './log-store.ts'
import { tick } from './orchestrator.ts'

const PARTIAL_CHARS = 8_000
const PARTIAL_MESSAGES = 3

const parseJson = (text: string | undefined): unknown => {
  try {
    return text === undefined ? undefined : (JSON.parse(text) as unknown)
  } catch {
    return undefined
  }
}

function taskIdsOf(after: Board, events: readonly EventBody[]): string[] {
  return events.flatMap(event => {
    if (event.type === 'ChangeLoaded') return [...after.order]
    if (event.type === 'TaskCreated' || event.type === 'TaskRestored') return [event.task.id]
    if ('taskId' in event) return event.taskId === undefined ? [] : [event.taskId]
    if ('agentId' in event) return [taskOfAgent(after, event.agentId)?.id ?? ''].filter(id => id !== '')
    return []
  })
}

export async function flushMirror(io: Io): Promise<void> {
  const board = await readBoard(io)
  if (board.changeId === null) return
  const result = await mirror.flush(io, { project: projectOf(await io.session.root()), change: board.changeId }, board)
  if (result.ok === board.mirrorPending) await append(io, [{ type: 'MirrorState', pending: !result.ok }])
}

async function restoreFromEngram(io: Io): Promise<Board> {
  const project = projectOf(await io.session.root())
  const active = parseJson((await fetchTopic(io, activeTopic(project)))?.text)
  const change = isRecord(active) && typeof active.change === 'string' ? active.change : undefined
  const loaded = change === undefined ? undefined : await loadChange(io, change)
  if (change === undefined || loaded === undefined || !loaded.ok) return readBoard(io)
  const index = parseJson((await fetchTopic(io, indexTopic(project, change)))?.text)
  const ids = isRecord(index) ? (stringArray(index.tasks) ?? []) : []
  const restored: EventBody[] = []
  for (const id of ids) {
    const record = parseJson((await fetchTopic(io, taskTopic(project, change, id)))?.text)
    if (isRecord(record) && isRecord(record.task)) restored.push({ type: 'TaskRestored', task: record.task as unknown as Task })
  }
  const control = isRecord(index) ? index : {}
  return append(io, [
    { type: 'ChangeLoaded', tasks: loaded.tasks },
    ...restored,
    { type: 'RunControl', running: control.running === true, paused: control.paused === true, ...(typeof control.scope === 'string' ? { scope: control.scope } : {}) },
  ], change)
}

async function partialOf(io: Io, run: AgentRun): Promise<string> {
  const messages = await io.session.messages({ agentId: run.agentId }).catch(() => undefined)
  const texts = Array.isArray(messages)
    ? messages.filter(entry => entry.role === 'assistant' && entry.text !== '').map(entry => entry.text).slice(-PARTIAL_MESSAGES)
    : []
  const transcript = `transcript: ${run.transcriptPath ?? 'unavailable'}`
  return texts.length === 0 ? `No partial output was readable; ${transcript}` : `${texts.join('\n\n').slice(-PARTIAL_CHARS)}\n\n${transcript}`
}

export async function recover(io: Io, ctx: Ctx, autoOpen: boolean): Promise<void> {
  const local = await readBoard(io)
  const board = local.changeId === null ? await restoreFromEngram(io) : local
  if (board.changeId === null) return
  const alive = new Set((await io.agent.list()).map(agent => agent.id))
  for (const id of board.order) {
    const task = board.tasks[id]
    const run = task === undefined ? undefined : activeRun(task)
    if (task === undefined || run === undefined || alive.has(run.agentId)) continue
    if (task.status !== 'running' && task.status !== 'review') continue
    await append(io, [
      { type: 'AgentStopped', agentId: run.agentId, outcome: 'interrupted' },
      { type: 'TaskUpdated', taskId: task.id, patch: { pending: { phase: run.phase, attempt: run.attempt, partial: await partialOf(io, run) } } },
    ])
  }
  if (autoOpen) void io.ui.open({ id: PANE_ID, title: 'zboard' })
  if (board.running) await tick(io, ctx)
}

/** Marks every task an append touched as dirty for the debounced Engram mirror; called once from register.tsx. */
export function installMirrorWiring(): void {
  onAppend(async (io, _before, after, events) => {
    mirror.markDirty(io, taskIdsOf(after, events), () => flushMirror(io))
  })
}
