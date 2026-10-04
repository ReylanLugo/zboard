import type { EngineInterface, On } from 'claude-code'
import type { Io } from '../runtime/io.ts'

import type { Role } from '../domain/types.ts'
import { READ_ONLY_PHASES, ROLE_OF, ROLES, agentTypeOf } from '../domain/types.ts'
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

export function agentSpec(role: Role, effort?: string): AgentSpecInput {
  return {
    name: role,
    description: ROLE_DESCRIPTIONS[role],
    prompt: SYSTEM_PROMPTS[role],
    background: true,
    ...(isReadOnly(role) ? { disallowedTools: ['Edit', 'Write', 'NotebookEdit'] } : {}),
    ...(effort === undefined ? {} : { effort }),
  }
}

export async function registerAgentTypes(io: { readonly agent: Pick<Io['agent'], 'register'> }): Promise<void> {
  for (const role of ROLES) await io.agent.register(agentSpec(role))
}

export function installAgentOffer(on: On): void {
  on('agent.offer', ($, e, next) => (e.agent.startsWith(`${$.plugin.name}:`) ? { isOffered: false } : next(e)))
}

const locks = new Map<Role, Promise<unknown>>()

/** Effort is a property of the agent type, so the role is re-registered with it right before its spawn, one role at a time. */
export async function spawnRole(io: Io, req: SpawnRequest): Promise<SpawnOutcome> {
  const previous = locks.get(req.role) ?? Promise.resolve()
  const run = previous.catch(() => undefined).then(async () => {
    await io.agent.register(agentSpec(req.role, req.effort))
    return io.agent.spawn({ subagentType: agentTypeOf(req.role), prompt: req.prompt, description: req.description, model: req.model })
  })
  locks.set(req.role, run)
  const result = await run
  if (result.deny !== undefined) return { deny: result.deny }
  return result.agentId === undefined ? { deny: 'the spawn answered without an agent id' } : { agentId: result.agentId, model: result.model }
}
