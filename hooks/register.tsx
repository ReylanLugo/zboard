import type { EngineInterface, Register } from 'claude-code'
import { atom, read, update } from 'claude-code'

import { installAgentOffer, registerAgentTypes } from './adapters/agents.ts'
import { parseArgs } from './commands/args.ts'
import { dispatch, registerCommand } from './commands/zboard.ts'
import { installEngramAllow } from './adapters/engram.ts'
import type { LogState } from './domain/log.ts'
import { EMPTY_LOG } from './domain/log.ts'
import type { Ctx } from './runtime/ctx.ts'
import type { Io } from './runtime/io.ts'
import { isolate } from './runtime/log-store.ts'
import type { UiState } from './runtime/ui-types.ts'
import { DEFAULT_UI } from './runtime/ui-types.ts'
import { boardAgent, boardArtifact, boardStatus, boardTask, registerReadTools } from './tools/board-read.ts'

// Composition root. Claude Code's checker reads `$.state` only through atoms
// declared as consts of the calling file and follows `$` only into functions of
// this file, so the atoms, `ioOf` and every hook that needs state live here.

const logAtom = atom({ plugin: 'zboard', key: 'log' } as const, EMPTY_LOG)
const uiAtom = atom({ plugin: 'zboard', key: 'ui' } as const, DEFAULT_UI)
const artifactsAtom = atom({ plugin: 'zboard', key: 'artifacts' } as const, {})

/** Repo-relative paths are the domain's; the engine resolves relative paths against its own cwd. */
async function inRepo($: EngineInterface, path: string): Promise<string> {
  return path.startsWith('/') ? path : `${await $.session.root()}/${path}`
}

/** The ports every other module receives instead of `$`. */
function ioOf($: EngineInterface): Io {
  return {
    fs: {
      read: async path => $.fs.read(await inRepo($, path)),
      write: async (path, text) => $.fs.write(await inRepo($, path), text),
      exists: async path => $.fs.exists(await inRepo($, path)),
      stat: async (path, options) => $.fs.stat(await inRepo($, path), options),
    },
    process: { run: (argv, init) => $.process.run(argv, init) },
    agent: {
      register: spec => $.agent.register(spec),
      spawn: input => $.agent.spawn(input),
      list: () => $.agent.list(),
    },
    tool: {
      call: input => $.tool.call(input),
      register: spec => $.tool.register(spec),
    },
    clock: {
      now: () => $.clock.now(),
      after: (ms, fn) => $.clock.after(ms, fn),
    },
    state: {
      // The contract declares these values structurally; the domain types narrow them here.
      log: {
        read: async () => (await read($, logAtom)) as LogState,
        update: fn => update($, logAtom, current => fn(current as LogState)) as Promise<LogState>,
      },
      ui: {
        read: async () => (await read($, uiAtom)) as UiState,
        update: fn => update($, uiAtom, current => fn(current as UiState)) as Promise<UiState>,
      },
      artifacts: {
        read: () => read($, artifactsAtom),
        update: fn => update($, artifactsAtom, fn),
      },
    },
    command: { register: spec => $.command.register(spec) },
    session: { root: () => $.session.root() },
    ui: {
      open: request => $.ui.open(request),
      invalidate: () => $.ui.invalidate('ui.render'),
      debug: text => $.ui.log(text, { to: 'debug' }),
    },
  }
}

export const register: Register = (on, options) => {
  const ctx: Ctx = { options }
  installEngramAllow(on)
  installAgentOffer(on)

  // The engine allows one unmatched hook per event, so session.start setup lives here.
  on('session.start', async ($, e, next) => {
    const io = ioOf($)
    await registerAgentTypes(io)
    await registerReadTools(io)
    await registerCommand(io)
    return next(e)
  })

  on('tool.call', { tool: 'mcp__zboard__board_status' }, async $ => {
    const io = ioOf($)
    return isolate(io, 'board_status', () => boardStatus(io), { deny: 'zboard: board_status failed' })
  })
  on('tool.call', { tool: 'mcp__zboard__board_task' }, async ($, e) => {
    const io = ioOf($)
    return isolate(io, 'board_task', () => boardTask(io, String(e.taskId ?? '')), { deny: 'zboard: board_task failed' })
  })
  on('tool.call', { tool: 'mcp__zboard__board_artifact' }, async ($, e) => {
    const io = ioOf($)
    const answer = () => boardArtifact(io, String(e.taskId ?? ''), String(e.phase ?? ''))
    return isolate(io, 'board_artifact', answer, { deny: 'zboard: board_artifact failed' })
  })
  on('tool.call', { tool: 'mcp__zboard__board_agent' }, async ($, e) => {
    const io = ioOf($)
    return isolate(io, 'board_agent', () => boardAgent(io, String(e.agentId ?? '')), { deny: 'zboard: board_agent failed' })
  })

  on('command.run', { command: 'zboard' }, async ($, e) => {
    const io = ioOf($)
    const text = await isolate(io, 'command.zboard', () => dispatch(io, ctx, parseArgs(e.args)), 'zboard: the command failed; see the board header.')
    return { text }
  })
}
