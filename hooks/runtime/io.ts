import type { AgentSpawnArgs, AgentSpawnResult, EngineInterface, Timer, ToolCallResult } from 'claude-code'

/**
 * Ports the engine lends to adapters and handlers.
 *
 * Claude Code's module checker follows `$` only into functions declared in the
 * same file, never across an import, so no module other than `register.tsx`
 * may receive `$`. `register.tsx` builds an `Io` of closures over `$` (`ioOf`)
 * and hands it to imported code; tests build one over the kit's engine
 * (`testIo`). The interface grows with the ports later tasks need.
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
  }
  readonly clock: {
    readonly now: () => Promise<number>
    readonly after: (ms: number, fn: () => void) => Timer
  }
}
