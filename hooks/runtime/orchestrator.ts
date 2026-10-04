import type { Io } from './io.ts'

import { spawnRole } from '../adapters/agents.ts'
import { readProjectConfig } from '../adapters/config-io.ts'
import { snapshot } from '../adapters/git.ts'
import { loadChange } from '../adapters/openspec.ts'
import { phasePrompt } from '../adapters/prompts.ts'
import { configWarnings, globalLayer, resolveChoice } from '../domain/config.ts'
import { activeRun } from '../domain/project.ts'
import { runnable, waitReason, writeConflict } from '../domain/scheduler.ts'
import type { PendingPhase, Phase, Task } from '../domain/types.ts'
import { PHASES, ROLE_OF, WRITE_PHASES, agentTypeOf } from '../domain/types.ts'
import type { Ctx } from './ctx.ts'
import { concurrencyOf } from './ctx.ts'
import { append, getArtifact, isolateTask, readBoard } from './log-store.ts'

export interface RunScope {
  readonly changeId: string
  readonly label?: string
}

export async function startRun(io: Io, ctx: Ctx, scope: RunScope): Promise<string> {
  const loaded = await loadChange(io, scope.changeId)
  if (!loaded.ok) return `zboard: ${loaded.reason}`
  if (scope.label !== undefined && !loaded.tasks.some(task => task.label === scope.label)) {
    return `zboard: unknown task ${scope.label} in ${scope.changeId}`
  }
  const project = await readProjectConfig(io)
  await append(io, [
    { type: 'ChangeLoaded', tasks: loaded.tasks },
    { type: 'RunControl', running: true, paused: false, ...(scope.label === undefined ? {} : { scope: scope.label }) },
    { type: 'ConfigWarnings', warnings: configWarnings(project, ctx.options) },
  ], scope.changeId)
  await tick(io, ctx)
  const unparsed = loaded.unparsed.length === 0 ? '' : ` (${loaded.unparsed.length} unparsed line(s) in tasks.md)`
  return `zboard: running ${scope.changeId}${scope.label === undefined ? '' : `/${scope.label}`}${unparsed}`
}

export async function pauseRun(io: Io): Promise<string> {
  const board = await readBoard(io)
  if (!board.running) return 'zboard: nothing is running.'
  await append(io, [{ type: 'RunControl', running: true, paused: true, ...(board.scope === undefined ? {} : { scope: board.scope }) }])
  return 'zboard: paused. In-flight phases finish; no new phase starts until /zboard run.'
}

let queue: Promise<void> = Promise.resolve()

/** Ticks run one at a time so a pending phase is never launched twice. */
export function tick(io: Io, ctx: Ctx): Promise<void> {
  const run = queue.then(() => tickNow(io, ctx))
  queue = run.catch(() => undefined)
  return run
}

async function tickNow(io: Io, ctx: Ctx): Promise<void> {
  const board = await readBoard(io)
  if (!board.running || board.paused) return
  for (const id of board.order) {
    if (board.tasks[id]?.pending !== undefined) await isolateTask(io, 'tick.pending', id, () => launchPending(io, ctx, id))
  }
  const fresh = await readBoard(io)
  for (const id of runnable(fresh, { limit: concurrencyOf(ctx), scope: fresh.scope })) {
    await isolateTask(io, 'tick.start', id, async () => {
      await append(io, [{ type: 'TaskUpdated', taskId: id, patch: { pending: { phase: 'research', attempt: 1 } } }])
      await launchPending(io, ctx, id)
    })
  }
}

export async function setPending(io: Io, ctx: Ctx, taskId: string, pending: PendingPhase): Promise<void> {
  await append(io, [{ type: 'TaskUpdated', taskId, patch: { pending } }])
  await tick(io, ctx)
}

async function launchPending(io: Io, ctx: Ctx, id: string): Promise<void> {
  const board = await readBoard(io)
  const task = board.tasks[id]
  if (task?.pending === undefined || activeRun(task) !== undefined) return
  if (WRITE_PHASES.includes(task.pending.phase)) {
    const conflict = writeConflict(board, id)
    if (conflict !== undefined) {
      const reason = waitReason(conflict)
      if (task.waitReason !== reason) await append(io, [{ type: 'TaskUpdated', taskId: id, patch: { waitReason: reason } }])
      return
    }
  }
  await spawnPhase(io, ctx, task, task.pending)
}

async function priorArtifacts(io: Io, task: Task, phase: Phase): Promise<{ phase: Phase; text: string }[]> {
  const records = PHASES.filter(other => other !== phase).flatMap(other => {
    const record = [...task.phases].reverse().find(entry => entry.phase === other && entry.gate === 'pass')
    return record === undefined ? [] : [record]
  })
  return Promise.all(records.map(async record => ({
    phase: record.phase,
    text: (record.artifactKey === undefined ? undefined : await getArtifact(io, record.artifactKey)) ?? record.summary ?? '',
  })))
}

export async function spawnPhase(io: Io, ctx: Ctx, task: Task, pending: PendingPhase): Promise<void> {
  const role = ROLE_OF[pending.phase]
  const loop = pending.phase === 'refactor' && pending.attempt === 1 ? task.loop + 1 : task.loop
  const project = await readProjectConfig(io)
  const choice = resolveChoice(
    role,
    { task: task.overrides[role], project: project.layers[role], global: globalLayer(ctx.options, role) },
    { loop, autoEscalate: project.autoEscalate ?? ctx.options.autoEscalate === true },
  )
  const prompt = phasePrompt({
    task, phase: pending.phase, attempt: pending.attempt, failureReason: pending.reason, partial: pending.partial,
    artifacts: await priorArtifacts(io, task, pending.phase), comments: [],
  })
  const baseline = await snapshot(io, await io.session.root())
  const spawned = await spawnRole(io, { role, prompt, description: `${task.id} ${pending.phase}`, model: choice.modelId, effort: choice.effort })
  if ('deny' in spawned) {
    await append(io, [{ type: 'TaskStatusChanged', taskId: task.id, from: task.status, to: 'blocked', reason: `spawn denied: ${spawned.deny}` }])
    return
  }
  await append(io, [{
    type: 'PhaseStarted', taskId: task.id, phase: pending.phase, attempt: pending.attempt,
    agentId: spawned.agentId, agentType: agentTypeOf(role), role, model: spawned.model, effort: choice.effort, baseline,
  }])
}
