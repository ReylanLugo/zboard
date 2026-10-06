import type { EngineInterface, Register } from 'claude-code'
import { atom, read, update } from 'claude-code'

import { installAgentOffer, registerAgentTypes, registerPlanAgentTypes } from './adapters/agents.ts'
import { parseArgs } from './commands/args.ts'
import { dispatch, registerCommand } from './commands/zboard.ts'
import { installEngramAllow } from './adapters/engram.ts'
import type { LogState } from './domain/log.ts'
import { EMPTY_LOG, boardOf } from './domain/log.ts'
import type { PlanLog } from './plan/plan-log.ts'
import { EMPTY_PLAN_LOG } from './plan/plan-log.ts'
import type { Ctx } from './runtime/ctx.ts'
import type { Io } from './runtime/io.ts'
import { captureStop, captureTokens, touch } from './runtime/capture.ts'
import { guardWrite } from './runtime/guard.ts'
import { noteFor } from './runtime/inject.ts'
import { append, isolate, readBoard } from './runtime/log-store.ts'
import { mirrorCreated, mirrorUpdated } from './runtime/native.ts'
import { installNotify } from './runtime/notify.ts'
import { installOrchestrator } from './runtime/orchestrator.ts'
import { planStop, planTokens } from './runtime/plan-runner.ts'
import { isolatePlan } from './runtime/plan-store.ts'
import { closeDetail, renderDetail } from './ui/Detail.tsx'
import { focusCard, renderPane } from './ui/Pane.tsx'
import { applyStoredPrefs } from './ui/prefs.ts'
import { flushMirror, installMirrorWiring, recover } from './runtime/recovery.ts'
import { fileChanged, startPolling, watchPathsFor } from './runtime/watcher.ts'
import type { UiState } from './runtime/ui-types.ts'
import { DEFAULT_UI } from './runtime/ui-types.ts'
import { boardAgent, boardArtifact, boardStatus, boardTask, registerReadTools } from './tools/board-read.ts'
import { assignTool, commentTool, createTaskTool, moveTool, registerWriteTools } from './tools/board-write.ts'

// Composition root. Claude Code's checker reads `$.state` only through atoms
// declared as consts of the calling file and follows `$` only into functions of
// this file, so the atoms, `ioOf` and every hook that needs state live here.

const logAtom = atom({ plugin: 'zboard', key: 'log' } as const, EMPTY_LOG)
const uiAtom = atom({ plugin: 'zboard', key: 'ui' } as const, DEFAULT_UI)
const artifactsAtom = atom({ plugin: 'zboard', key: 'artifacts' } as const, {})
const planAtom = atom({ plugin: 'zboard', key: 'plan' } as const, EMPTY_PLAN_LOG)

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
      list: async path => $.fs.list(await inRepo($, path)),
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
    store: {
      get: key => $.store.get(key),
      set: (key, value) => $.store.set(key, value),
    },
    clock: {
      now: () => $.clock.now(),
      after: (ms, fn) => $.clock.after(ms, fn),
      every: (ms, fn) => $.clock.every(ms, fn),
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
      plan: {
        read: async () => (await read($, planAtom)) as PlanLog,
        update: fn => update($, planAtom, current => fn(current as PlanLog)) as Promise<PlanLog>,
      },
    },
    command: { register: spec => $.command.register(spec) },
    session: {
      root: () => $.session.root(),
      messages: query => $.session.messages(query),
      append: args => $.session.append(args),
    },
    ui: {
      open: request => $.ui.open(request),
      close: request => $.ui.close(request),
      toast: text => $.ui.toast(text),
      invalidate: () => $.ui.invalidate('ui.render'),
      debug: text => $.ui.log(text, { to: 'debug' }),
    },
  }
}

export const register: Register = (on, options) => {
  const ctx: Ctx = { options }

  // Allowed-file guard (runtime/guard.ts), registered first so it sits above every other tool.call hook.
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const deny = await guardWrite(ioOf($), e.agentId, e.file_path)
    return deny === undefined ? next(e) : { deny }
  })
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const deny = await guardWrite(ioOf($), e.agentId, e.file_path)
    return deny === undefined ? next(e) : { deny }
  })
  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const deny = await guardWrite(ioOf($), e.agentId, e.notebook_path)
    return deny === undefined ? next(e) : { deny }
  })

  installEngramAllow(on)
  installAgentOffer(on)
  installOrchestrator(ctx)
  installMirrorWiring()
  installNotify()

  // The engine allows one unmatched hook per event, so session.start setup lives here:
  // registrations, then (once the session started) tasks.md polling and recovery.
  on('session.start', async ($, e, next) => {
    const io = ioOf($)
    await registerAgentTypes(io)
    await registerPlanAgentTypes(io)
    await registerReadTools(io)
    await registerWriteTools(io)
    await registerCommand(io)
    await isolate(io, 'prefs.session.start', () => applyStoredPrefs(io), undefined)
    const started = await next(e)
    startPolling(io, ctx)
    await isolate(io, 'recovery.session.start', () => recover(io, ctx, true), undefined)
    return started
  })

  // Watcher and recovery (runtime/watcher.ts, runtime/recovery.ts).
  on('classic.FileChanged', async ($, e, next) => {
    const result = await next(e)
    const io = ioOf($)
    await isolate(io, 'classic.FileChanged', () => fileChanged(io, ctx, e.file_path), undefined)
    return result
  })
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    const io = ioOf($)
    const paths = await isolate(io, 'classic.SessionStart', () => watchPathsFor(io), [])
    return paths.length === 0 ? result : { ...result, watchPaths: [...(result.watchPaths ?? []), ...paths] }
  })
  on('classic.PostCompact', async ($, e, next) => {
    const result = await next(e)
    const io = ioOf($)
    await isolate(io, 'classic.PostCompact', () => recover(io, ctx, false), undefined)
    return result
  })
  on('classic.PreCompact', async ($, e, next) => {
    const io = ioOf($)
    await isolate(io, 'classic.PreCompact', () => flushMirror(io), undefined)
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

  // Board write tools (tools/board-write.ts).
  on('tool.call', { tool: 'mcp__zboard__board_create_task' }, async ($, e) => {
    const io = ioOf($)
    return isolate(io, 'board_create_task', () => createTaskTool(io, e), { deny: 'zboard: board_create_task failed' })
  })
  on('tool.call', { tool: 'mcp__zboard__board_comment' }, async ($, e) => {
    const io = ioOf($)
    return isolate(io, 'board_comment', () => commentTool(io, e), { deny: 'zboard: board_comment failed' })
  })
  on('tool.call', { tool: 'mcp__zboard__board_move' }, async ($, e) => {
    const io = ioOf($)
    return isolate(io, 'board_move', () => moveTool(io, e), { deny: 'zboard: board_move failed' })
  })
  on('tool.call', { tool: 'mcp__zboard__board_assign' }, async ($, e) => {
    const io = ioOf($)
    return isolate(io, 'board_assign', () => assignTool(io, e), { deny: 'zboard: board_assign failed' })
  })

  on('command.run', { command: 'zboard' }, async ($, e) => {
    const io = ioOf($)
    const text = await isolate(io, 'command.zboard', () => dispatch(io, ctx, parseArgs(e.args)), 'zboard: the command failed; see the board header.')
    return { text }
  })

  // Engine capture (runtime/capture.ts): the engine's own result always passes through.
  on('classic.SubagentStart', async ($, e, next) => {
    const result = await next(e)
    const io = ioOf($)
    await isolate(io, 'classic.SubagentStart', () => touch(io, e.agent_id), undefined)
    return result
  })
  on('classic.SubagentStop', async ($, e, next) => {
    const result = await next(e)
    const io = ioOf($)
    const stop = { agentId: e.agent_id, transcriptPath: e.agent_transcript_path, answer: e.last_assistant_message, effort: e.effort?.level }
    await isolate(io, 'classic.SubagentStop', () => captureStop(io, stop), undefined)
    await isolatePlan(io, 'plan.SubagentStop', () => planStop(io, ctx, stop), undefined)
    return result
  })
  // The one unmatched tool.call hook: activity capture, then comment delivery (runtime/inject.ts),
  // which appends pending comments to the agent's next tool result as `context`.
  on('tool.call', async ($, e, next) => {
    const agentId = e.agentId
    if (agentId === undefined) return next(e)
    const io = ioOf($)
    await isolate(io, 'capture.tool.call', () => touch(io, agentId, e.tool), undefined)
    const found = await isolate(io, 'inject.tool.call', async () => noteFor(await readBoard(io), agentId), undefined)
    const ran = await next(e)
    if (found === undefined || ran.deny !== undefined) return ran
    await isolate(io, 'inject.deliver', () => append(io, found.events), undefined)
    return { ...ran, context: [...(ran.context ?? []), found.note] }
  })
  on('turn.complete', async ($, e, next) => {
    const io = ioOf($)
    await isolate(io, 'capture.turn.complete', () => captureTokens(io, e.agentId, e.usage), undefined)
    await isolatePlan(io, 'plan.turn.complete', () => planTokens(io, e.agentId, e.usage), undefined)
    return next(e)
  })

  // Native task mirroring (runtime/native.ts): the native result is what the model sees.
  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    const io = ioOf($)
    await isolate(io, 'native.TaskCreate', () => mirrorCreated(io, ran, e), undefined)
    return ran
  })
  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    const io = ioOf($)
    await isolate(io, 'native.TaskUpdate', () => mirrorUpdated(io, ran, e.taskId, e), undefined)
    return ran
  })

  // The board pane (ui/Pane.tsx). Reading the atoms here subscribes the drawing to them.
  on('ui.render', { component: 'Pane', requestId: 'zboard' }, async ($, e) => {
    const board = boardOf((await read($, logAtom)) as LogState)
    const ui = (await read($, uiAtom)) as UiState
    const now = await $.clock.now()
    return renderPane($.ui.resolve(e), e.surface, ioOf($), { board, ui, now, columns: e.props.bodyColumns })
  })
  on('ui.focus', async ($, e, next) => {
    const io = ioOf($)
    await isolate(io, 'ui.focus', () => focusCard(io, e.requestId, e.element), undefined)
    return next(e)
  })

  // The task detail pane (ui/Detail.tsx); matchers name the pane id literally.
  on('ui.render', { component: 'Pane', requestId: 'zboard-detail' }, async ($, e) => {
    const board = boardOf((await read($, logAtom)) as LogState)
    const ui = (await read($, uiAtom)) as UiState
    const artifacts = await read($, artifactsAtom)
    const now = await $.clock.now()
    return renderDetail($.ui.resolve(e), ioOf($), { board, ui, artifacts, now })
  })
  on('ui.close', { id: 'zboard-detail' }, async ($, e, next) => {
    const io = ioOf($)
    await isolate(io, 'ui.close', () => closeDetail(io), undefined)
    return next(e)
  })
}
