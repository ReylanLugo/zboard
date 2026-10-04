import type { Io } from './io.ts'

export interface AgentStop {
  readonly agentId: string
  readonly answer?: string
  readonly transcriptPath?: string
  readonly effort?: string
}

type StopListener = (io: Io, stop: AgentStop) => Promise<void>

const stopListeners: StopListener[] = []

export const onAgentStop = (listener: StopListener): void => {
  stopListeners.push(listener)
}

export async function emitAgentStop(io: Io, stop: AgentStop): Promise<void> {
  for (const listener of stopListeners) await listener(io, stop)
}
