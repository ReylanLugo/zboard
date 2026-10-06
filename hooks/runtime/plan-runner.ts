import type { Io } from './io.ts'

import { spawnPlanRole } from '../adapters/agents.ts'
import { readProjectConfig } from '../adapters/config-io.ts'
import { globalLayer, resolvePlanChoice } from '../domain/config.ts'
import type { Parsed } from '../plan/contracts.ts'
import { changeOfAgent } from '../plan/plan-project.ts'
import type { PlanJob, PlanRole } from '../plan/types.ts'
import { PLAN_MAX_ATTEMPTS } from '../plan/types.ts'
import type { AgentStop } from './bus.ts'
import type { Ctx } from './ctx.ts'
import { message } from './log-store.ts'
import { appendPlan, readPlan } from './plan-store.ts'

type Kind = PlanJob['kind']
type JobOf<K extends Kind> = Extract<PlanJob, { readonly kind: K }>

export interface JobHandler<J extends PlanJob, V> {
  readonly prompt: (io: Io, changeId: string, job: J, gateReason?: string) => Promise<string>
  readonly parse: (answer: string | undefined) => Parsed<V>
  readonly done: (io: Io, ctx: Ctx, changeId: string, job: J, value: V) => Promise<void>
  readonly failed?: (io: Io, ctx: Ctx, changeId: string, job: J) => Promise<void>
}

type AnyHandler = JobHandler<PlanJob, unknown>

export const ROLE_OF_JOB: Readonly<Record<Kind, PlanRole>> = {
  brainstorm: 'brainstormer',
  draft: 'drafter',
  explain: 'explainer',
  critique: 'critic',
  judge: 'judge',
}

export const TOKENS_KEY = 'zplan/tokens/drafter'
export const TOKEN_HISTORY = 20

const handlers = new Map<Kind, AnyHandler>()

export function defineJob<K extends Kind, V>(kind: K, handler: JobHandler<JobOf<K>, V>): void {
  handlers.set(kind, handler as unknown as AnyHandler)
}

const handlerOf = (kind: Kind): AnyHandler => {
  const handler = handlers.get(kind)
  if (handler === undefined) throw new Error(`no plan job handler for ${kind}`)
  return handler
}

const queues = new Map<string, Promise<unknown>>()

/** One run per key at a time: a second start (or Accept) waits, then sees what the first one recorded. */
export function serialized<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve()
  const run = previous.catch(() => undefined).then(work)
  queues.set(key, run)
  return run
}

export function startJob(io: Io, ctx: Ctx, changeId: string, job: PlanJob, attempt = 1, gateReason?: string): Promise<boolean> {
  return serialized(`agent:${changeId}`, async () => {
    if ((await readPlan(io)).changes[changeId]?.activeAgent !== undefined) {
      io.ui.toast(`zboard: an agent is already running for ${changeId}`)
      return false
    }
    const role = ROLE_OF_JOB[job.kind]
    const project = await readProjectConfig(io)
    const choice = resolvePlanChoice(role, { project: project.layers[role], global: globalLayer(ctx.options, role) }, job.kind === 'draft' ? job.artifact : undefined)
    const prompt = await handlerOf(job.kind).prompt(io, changeId, job, gateReason).then(
      text => ({ text }),
      (error: unknown) => ({ error: message(error) }),
    )
    if ('error' in prompt) {
      await appendPlan(io, [{ type: 'PlanError', changeId, hook: `prompt.${job.kind}`, message: prompt.error }])
      return false
    }
    const spawned = await spawnPlanRole(io, {
      role, prompt: prompt.text, description: `zboard ${role} for ${changeId}`, model: choice.modelId, ...(choice.effort === undefined ? {} : { effort: choice.effort }),
    })
    if ('deny' in spawned) {
      await appendPlan(io, [{ type: 'PlanError', changeId, hook: `spawn.${role}`, message: spawned.deny }])
      return false
    }
    const startedAt = await io.clock.now()
    await appendPlan(io, [{ type: 'PlanAgentStarted', changeId, agent: { agentId: spawned.agentId, role, job, attempt, startedAt, model: choice.model } }])
    return true
  })
}

/** Handles a plan agent's end (classic.SubagentStop): validate, retry once with the gate reason, or record the failure. */
export async function planStop(io: Io, ctx: Ctx, stop: AgentStop): Promise<void> {
  const rec = changeOfAgent(await readPlan(io), stop.agentId)
  const active = rec?.activeAgent
  if (rec === undefined || active === undefined) return
  const handler = handlerOf(active.job.kind)
  const parsed = handler.parse(stop.answer)
  if (parsed.ok) {
    await appendPlan(io, [{ type: 'PlanAgentStopped', changeId: rec.id, agentId: stop.agentId, outcome: 'ok' }])
    await handler.done(io, ctx, rec.id, active.job, parsed.value)
    return
  }
  await appendPlan(io, [{ type: 'PlanAgentStopped', changeId: rec.id, agentId: stop.agentId, outcome: 'failed' }])
  if (active.attempt < PLAN_MAX_ATTEMPTS) {
    await startJob(io, ctx, rec.id, active.job, active.attempt + 1, parsed.reason)
    return
  }
  await appendPlan(io, [{ type: 'PlanError', changeId: rec.id, hook: `agent.${active.role}`, message: `${active.role} gave no valid answer twice: ${parsed.reason}` }])
  await handler.failed?.(io, ctx, rec.id, active.job)
}

export async function retryJob(io: Io, ctx: Ctx, changeId: string): Promise<boolean> {
  const retryable = (await readPlan(io)).changes[changeId]?.retryable
  if (retryable === undefined) {
    io.ui.toast(`zboard: nothing to retry for ${changeId}`)
    return false
  }
  return startJob(io, ctx, changeId, retryable.job)
}

/** One history entry per completed drafter turn; the plan forecast averages them. */
export async function planTokens(
  io: Io,
  agentId: string | undefined,
  usage: { readonly input_tokens?: number; readonly output_tokens?: number } | undefined,
): Promise<void> {
  if (agentId === undefined) return
  if (changeOfAgent(await readPlan(io), agentId)?.activeAgent?.role !== 'drafter') return
  const tokens = (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0)
  if (tokens <= 0) return
  const stored = await io.store.get(TOKENS_KEY)
  const history = Array.isArray(stored) ? stored.filter((value): value is number => typeof value === 'number') : []
  await io.store.set(TOKENS_KEY, [...history, tokens].slice(-TOKEN_HISTORY))
}
