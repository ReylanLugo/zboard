import type { AgentSpawnArgs, EngineInterface, On } from 'claude-code'
import type { Io } from '../runtime/io.ts'

import type { Role } from '../domain/types.ts'
import { AGENT_PREFIX, READ_ONLY_PHASES, ROLE_OF, ROLES, agentTypeOf } from '../domain/types.ts'
import type { PlanRole } from '../plan/types.ts'
import { PLAN_ROLES } from '../plan/types.ts'
import { PLAN_DESCRIPTIONS, PLAN_SYSTEM_PROMPTS } from './prompts-plan.ts'
import { ROLE_DESCRIPTIONS, SYSTEM_PROMPTS } from './prompts.ts'

type AgentSpecInput = Parameters<EngineInterface['agent']['register']>[0]

export interface SpawnRequest {
  readonly role: Role
  readonly prompt: string
  readonly description: string
  readonly model: string
  readonly effort?: string
}

export type SpawnOutcome = { readonly agentId: string; readonly model: string } | { readonly deny: string }

const isReadOnly = (role: Role): boolean =>
  READ_ONLY_PHASES.some(phase => ROLE_OF[phase] === role)

/** The definition's model and effort apply to the spawn: the Agent tool's own `model` takes only aliases, never a full id. */
const choiceOf = (effort?: string, model?: string): Partial<AgentSpecInput> => ({
  ...(model === undefined ? {} : { model }),
  ...(effort === undefined ? {} : { effort }),
})

export function agentSpec(role: Role, effort?: string, model?: string): AgentSpecInput {
  return {
    name: role,
    description: ROLE_DESCRIPTIONS[role],
    prompt: SYSTEM_PROMPTS[role],
    background: true,
    ...(isReadOnly(role) ? { disallowedTools: ['Edit', 'Write', 'NotebookEdit'] } : {}),
    ...choiceOf(effort, model),
  }
}

export async function registerAgentTypes(io: { readonly agent: Pick<Io['agent'], 'register'> }): Promise<void> {
  for (const role of ROLES) await io.agent.register(agentSpec(role))
}

export function installAgentOffer(on: On): void {
  on('agent.offer', ($, e, next) => (e.agent.startsWith(`${$.plugin.name}:`) ? { isOffered: false } : next(e)))
}

/** Plan agents only read and answer: no file edits, no commands, no board writes, no memory writes. */
export const PLAN_DISALLOWED: readonly string[] = [
  'Edit', 'Write', 'NotebookEdit', 'Bash',
  'mcp__zboard__board_create_task', 'mcp__zboard__board_comment', 'mcp__zboard__board_move', 'mcp__zboard__board_assign',
  'mcp__engram__mem_save',
]

export function planAgentSpec(role: PlanRole, effort?: string, model?: string): AgentSpecInput {
  return {
    name: role,
    description: PLAN_DESCRIPTIONS[role],
    prompt: PLAN_SYSTEM_PROMPTS[role],
    background: true,
    disallowedTools: [...PLAN_DISALLOWED],
    ...choiceOf(effort, model),
  }
}

export async function registerPlanAgentTypes(io: { readonly agent: Pick<Io['agent'], 'register'> }): Promise<void> {
  for (const role of PLAN_ROLES) await io.agent.register(planAgentSpec(role))
}

const locks = new Map<string, Promise<unknown>>()

/**
 * Model and effort are properties of the agent type, so a type is re-registered right before its spawn,
 * one spawn per type at a time; the spawn itself names no model, so the definition's full id applies.
 */
async function spawnTyped(io: Io, spec: AgentSpecInput, args: AgentSpawnArgs): Promise<SpawnOutcome> {
  const previous = locks.get(spec.name) ?? Promise.resolve()
  const run = previous.catch(() => undefined).then(async () => {
    await io.agent.register(spec)
    return io.agent.spawn(args)
  })
  locks.set(spec.name, run)
  const result = await run
  if (result.deny !== undefined) return { deny: result.deny }
  return result.agentId === undefined ? { deny: 'the spawn answered without an agent id' } : { agentId: result.agentId, model: result.model }
}

export const spawnRole = (io: Io, req: SpawnRequest): Promise<SpawnOutcome> =>
  spawnTyped(io, agentSpec(req.role, req.effort, req.model), { subagentType: agentTypeOf(req.role), prompt: req.prompt, description: req.description })

export interface PlanSpawnRequest {
  readonly role: PlanRole
  readonly prompt: string
  readonly description: string
  readonly model: string
  readonly effort?: string
}

export const spawnPlanRole = (io: Io, req: PlanSpawnRequest): Promise<SpawnOutcome> =>
  spawnTyped(io, planAgentSpec(req.role, req.effort, req.model), { subagentType: `${AGENT_PREFIX}:${req.role}`, prompt: req.prompt, description: req.description })
