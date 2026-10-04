import type { Io } from './io.ts'

import { spawnRole } from '../adapters/agents.ts'
import { mirror, phaseTopic, projectOf, truncateArtifact } from '../adapters/engram.ts'
import { readProjectConfig } from '../adapters/config-io.ts'
import { snapshot } from '../adapters/git.ts'
import { loadChange } from '../adapters/openspec.ts'
import { phasePrompt } from '../adapters/prompts.ts'
import { configWarnings, globalLayer, resolveChoice } from '../domain/config.ts'
import type { EventBody } from '../domain/events.ts'
import type { Action } from '../domain/pipeline.ts'
import { next } from '../domain/pipeline.ts'
import { formatComment, undelivered } from '../domain/comments.ts'
import { activeRun, runOf, taskOfAgent } from '../domain/project.ts'
import { runnable, waitReason, writeConflict } from '../domain/scheduler.ts'
import type { AgentRun, PendingPhase, Phase, Task } from '../domain/types.ts'
import { PHASES, ROLE_OF, WRITE_PHASES, agentTypeOf } from '../domain/types.ts'
import type { AgentStop } from './bus.ts'
import { onAgentStop } from './bus.ts'
import { closeTask } from './close.ts'
import type { Ctx } from './ctx.ts'
import { concurrencyOf } from './ctx.ts'
import type { Evaluation } from './evaluate.ts'
import { evaluateStop } from './evaluate.ts'
import { append, getArtifact, isolateTask, putArtifact, readBoard } from './log-store.ts'

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
  const pendingComments = undelivered(task)
  const prompt = phasePrompt({
    task, phase: pending.phase, attempt: pending.attempt, failureReason: pending.reason, partial: pending.partial,
    artifacts: await priorArtifacts(io, task, pending.phase), comments: pendingComments.map(formatComment),
  })
  const baseline = await snapshot(io, await io.session.root())
  const spawned = await spawnRole(io, { role, prompt, description: `${task.id} ${pending.phase}`, model: choice.modelId, effort: choice.effort })
  if ('deny' in spawned) {
    await append(io, [{ type: 'TaskStatusChanged', taskId: task.id, from: task.status, to: 'blocked', reason: `spawn denied: ${spawned.deny}` }])
    return
  }
  await append(io, [
    {
      type: 'PhaseStarted', taskId: task.id, phase: pending.phase, attempt: pending.attempt,
      agentId: spawned.agentId, agentType: agentTypeOf(role), role, model: spawned.model, effort: choice.effort, baseline,
    },
    ...pendingComments.map(comment => ({ type: 'CommentDelivered' as const, taskId: task.id, commentId: comment.id, to: agentTypeOf(role) })),
  ])
}

const WRITES: readonly Phase[] = ['tdd', 'code', 'refactor']

function completionEvents(task: Task, run: AgentRun, evaluation: Evaluation, artifactKey: string): EventBody[] {
  const { outcome } = evaluation
  const base = {
    taskId: task.id, phase: run.phase, attempt: run.attempt, artifactKey,
    touched: WRITES.includes(run.phase) ? evaluation.touched : [],
  }
  if (outcome.gate === 'fail') return [{ type: 'PhaseCompleted', ...base, gate: 'fail', reason: outcome.reason }]
  const testFiles = outcome.testFiles ?? (run.phase === 'tdd' ? evaluation.testFiles : undefined)
  return [
    {
      type: 'PhaseCompleted', ...base, gate: 'pass', summary: outcome.summary,
      ...(outcome.allowedFiles === undefined ? {} : { allowedFiles: outcome.allowedFiles }),
      ...(testFiles === undefined ? {} : { testFiles }),
    },
    ...(outcome.verdict === undefined ? [] : [{ type: 'ReviewVerdictRecorded' as const, taskId: task.id, verdict: outcome.verdict }]),
  ]
}

async function execute(io: Io, ctx: Ctx, task: Task, action: Action): Promise<void> {
  switch (action.kind) {
    case 'advance':
      return setPending(io, ctx, task.id, { phase: action.phase, attempt: 1 })
    case 'spawn':
      return setPending(io, ctx, task.id, { phase: action.phase, attempt: action.attempt, reason: action.reason })
    case 'loop':
      return setPending(io, ctx, task.id, { phase: 'refactor', attempt: 1 })
    case 'escalate':
      await append(io, [{ type: 'TaskStatusChanged', taskId: task.id, from: task.status, to: 'needs_decision', reason: action.reason }])
      return tick(io, ctx)
    case 'done':
      await closeTask(io, task)
      return tick(io, ctx)
  }
}

const inFlight = new Set<string>()

/** Claimed synchronously, before any await, so a concurrent duplicate stop sees the claim. */
async function completePhase(io: Io, ctx: Ctx, stop: AgentStop): Promise<void> {
  if (inFlight.has(stop.agentId)) return
  inFlight.add(stop.agentId)
  try {
    const board = await readBoard(io)
    const task = taskOfAgent(board, stop.agentId)
    const run = task === undefined ? undefined : runOf(task, stop.agentId)
    if (task === undefined || run === undefined || run.outcome !== undefined) return
    if (task.status !== 'running' && task.status !== 'review') return
    await isolateTask(io, 'orchestrator.complete', task.id, async () => {
      const root = await io.session.root()
      const answer = stop.answer ?? ''
      const evaluation = await evaluateStop(io, board, task, run, answer, root)
      const n = task.phases.filter(record => record.phase === run.phase).length + 1
      const artifactKey = phaseTopic(projectOf(root), task.changeId, task.id, run.phase, n)
      const stored = truncateArtifact(answer, stop.transcriptPath)
      await putArtifact(io, artifactKey, stored)
      mirror.addArtifact(artifactKey, stored)
      const after = await append(io, completionEvents(task, run, evaluation, artifactKey))
      const updated = after.tasks[task.id]
      if (updated !== undefined) {
        await execute(io, ctx, updated, next(updated, { kind: 'completed', phase: run.phase, attempt: run.attempt, outcome: evaluation.outcome }))
      }
    })
  } finally {
    inFlight.delete(stop.agentId)
  }
}

/** Subscribes completion to the agent-stop bus; called once from register.tsx. */
export function installOrchestrator(ctx: Ctx): void {
  onAgentStop((io, stop) => completePhase(io, ctx, stop))
}
