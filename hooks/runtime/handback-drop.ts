import { runOf, taskOfAgent } from '../domain/project.ts'
import type { AgentCache } from './agent-cache.ts'
import type { CaughtNext } from './reentry-guard.ts'

// A zboard agent's SubagentHandback report reaches the main session as a peer
// turn, `<agent-message from="<agentId>">…`. zboard already took the report at
// the agent's turn.complete and shows it in its pane, so the peer turn is
// dropped instead of flooding the main conversation. The decision reads the
// agent cache alone, so the hook's `.catch` handler (defense in depth, where `$`
// rejects) can make the same one.

const AGENT_MESSAGE = /^\s*<agent-message from="([^"]+)"/

/** The agent a hand-back names at its head, or undefined for any other text. */
export const agentMessageFrom = (text: string): string | undefined => AGENT_MESSAGE.exec(text)?.[1]

/** The role of any agent zboard ran: a board task's run (ended or not), else a plan agent. */
export function knownRole(cache: AgentCache, agentId: string): string | undefined {
  const task = cache.board === undefined ? undefined : taskOfAgent(cache.board, agentId)
  const run = task === undefined ? undefined : runOf(task, agentId)
  return run?.role ?? cache.planRoles.get(agentId)
}

export interface PeerPrompt {
  readonly text: string
  readonly origin?: { readonly kind: string }
}

/** The drop reason for a zboard agent's peer hand-back; undefined lets the prompt in. */
export function handbackDrop(cache: AgentCache, prompt: PeerPrompt): string | undefined {
  if (prompt.origin?.kind !== 'peer') return undefined
  const agentId = agentMessageFrom(prompt.text)
  const role = agentId === undefined ? undefined : knownRole(cache, agentId)
  return role === undefined ? undefined : `zboard captured the ${role} report; see the zboard pane.`
}

/** The prompt hook's `.catch` body: a hook that had called `next` lets its prompt stand. */
export const caughtPrompt = (cache: AgentCache, prompt: PeerPrompt, next: CaughtNext): string | undefined =>
  next.called ? undefined : handbackDrop(cache, prompt)
