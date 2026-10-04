import type { AgentSpawnArgs, AgentSpawnResult, EngineInterface, Timer, ToolCallResult } from 'claude-code'

import type { LogState } from '../domain/log.ts'
import type { UiState } from './ui-types.ts'

/** One `$.state` value, read and updated (with the engine's version check) through `ioOf`. */
export interface StatePort<T> {
  readonly read: () => Promise<T>
  readonly update: (fn: (current: T) => T) => Promise<T>
}

/**
 * Ports the engine lends to adapters and handlers.
 *
 * Claude Code's module checker follows `$` only into functions declared in the
 * same file, never across an import, and reads `$.state` only through atoms
 * declared as consts of the calling file. So `register.tsx` alone holds the
 * atoms and builds an `Io` of closures over `$` (`ioOf`); every other module
 * receives that `Io`. Tests build one over an in-memory world (`worldIo`).
 */
export interface Io {
  readonly fs: {
    readonly read: (path: string) => Promise<string>
    readonly write: (path: string, text: string) => Promise<void>
    readonly exists: (path: string) => Promise<boolean>
    readonly stat: EngineInterface['fs']['stat']
  }
  readonly process: {
    readonly run: EngineInterface['process']['run']
  }
  readonly agent: {
    readonly register: EngineInterface['agent']['register']
    readonly spawn: (input: AgentSpawnArgs) => Promise<AgentSpawnResult>
    readonly list: EngineInterface['agent']['list']
  }
  readonly tool: {
    readonly call: (input: { readonly tool: `mcp__${string}__${string}` } & Record<string, unknown>) => Promise<ToolCallResult>
    readonly register: EngineInterface['tool']['register']
  }
  readonly clock: {
    readonly now: () => Promise<number>
    readonly after: (ms: number, fn: () => void) => Timer
  }
  readonly state: {
    readonly log: StatePort<LogState>
    readonly ui: StatePort<UiState>
    readonly artifacts: StatePort<Readonly<Record<string, string>>>
  }
  readonly ui: {
    /** Redraws every surface reading zboard's state. */
    readonly invalidate: () => void
    /** Writes a line to the debug log. */
    readonly debug: (text: string) => void
  }
}
