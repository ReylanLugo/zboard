import { infraCommandOf } from '../domain/infra.ts'
import { taskOfAgent } from '../domain/project.ts'
import { changeOfAgent } from '../plan/plan-project.ts'
import type { Io } from './io.ts'
import { readBoard, recordModError } from './log-store.ts'
import { readPlan } from './plan-store.ts'
import type { CaughtNext } from './reentry-guard.ts'

// The infrastructure guard: zboard's agents work on local files and the test command,
// so a Bash call by one that runs a cloud or infrastructure CLI is refused. The main
// session (no agentId) and subagents zboard did not spawn pass untouched.

export const INFRA_TOOL = 'Bash'

export const infraDenial = (cli: string): string =>
  `zboard: agents must not run infrastructure CLIs (${cli}); work only on local files and the test command.`

async function isZboardAgent(io: Io, agentId: string): Promise<boolean> {
  if (changeOfAgent(await readPlan(io), agentId) !== undefined) return true
  return taskOfAgent(await readBoard(io), agentId) !== undefined
}

/**
 * Decides one Bash call: a denial reason, or undefined to let it through. Fails closed:
 * if the guard cannot tell whether the agent is zboard's, a call that runs such a CLI is refused.
 */
export async function guardBash(io: Io, agentId: string | undefined, command: string): Promise<string | undefined> {
  if (agentId === undefined) return undefined
  const cli = infraCommandOf(command)
  if (cli === undefined) return undefined
  try {
    return (await isZboardAgent(io, agentId)) ? infraDenial(cli) : undefined
  } catch (error) {
    await recordModError(io, 'infra-guard', error)
    return infraDenial(cli)
  }
}

/**
 * The hook's `.catch` handler body, defense in depth: on re-entry the engine skipped the hook, so any
 * agent's infrastructure CLI is refused without the board; on a failure of the hook itself, pass what
 * it had let through and refuse an agent's infrastructure CLI otherwise.
 */
export function caughtBash(tool: string, agentId: string | undefined, command: string, next: CaughtNext): string | undefined {
  if (tool !== INFRA_TOOL || agentId === undefined) return undefined
  if (next.error?.kind !== 're-entry' && next.called) return undefined
  const cli = infraCommandOf(command)
  return cli === undefined ? undefined : infraDenial(cli)
}
