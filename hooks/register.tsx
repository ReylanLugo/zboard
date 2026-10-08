import type { EngineInterface, Register } from 'claude-code'
import { atom, read, update } from 'claude-code'

import { installAgentOffer, registerAgentTypes, registerPlanAgentTypes } from './adapters/agents.ts'
import { parseArgs } from './commands/args.ts'
import { dispatch, registerCommand, unprefixed } from './commands/zboard.ts'
import { installEngramAllow } from './adapters/engram.ts'
import type { LogState } from './domain/log.ts'
import { EMPTY_LOG, boardOf } from './domain/log.ts'
import type { PlanLog } from './plan/plan-log.ts'
import { EMPTY_PLAN_LOG, planOf } from './plan/plan-log.ts'
import type { Ctx } from './runtime/ctx.ts'
import type { Io } from './runtime/io.ts'
import type { Frame } from './runtime/frame.ts'
import { outsideFrame, withinFrame } from './runtime/frame.ts'
import { captureTokens, touch } from './runtime/capture.ts'
import { agentCell, flushPending, refreshAgents, withBoard, withPlanAgents } from './runtime/agent-cache.ts'
import { claimLedger, completeAgent } from './runtime/complete.ts'
import { guardWrite } from './runtime/guard.ts'
import { caughtBash, guardBash } from './runtime/infra-guard.ts'
import { noteFor } from './runtime/inject.ts'
import { append, isolate, onAppend, readBoard } from './runtime/log-store.ts'
import { mirrorCreated, mirrorUpdated } from './runtime/native.ts'
import { installNotify } from './runtime/notify.ts'
import { installOrchestrator, tickIfDue } from './runtime/orchestrator.ts'
import { readDocs } from './runtime/plan-docs.ts'
import { installPlanJobs } from './runtime/plan-jobs.ts'
import { flushPlanMirror, installPlanMirror } from './runtime/plan-mirror.ts'
import { recoverPlan } from './runtime/plan-recovery.ts'
import { planTokens } from './runtime/plan-runner.ts'
import { isolatePlan, onPlanAppend } from './runtime/plan-store.ts'
import { drainPressWork } from './runtime/press-work.ts'
import { caughtWrite } from './runtime/reentry-guard.ts'
import { deliverNote, reentryNote } from './runtime/reentry-notes.ts'
import { caughtPrompt, handbackDrop } from './runtime/handback-drop.ts'
import { closeChanges, focusChange, renderChanges } from './ui/ChangesPane.tsx'
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

/**
 * The ports every other module receives instead of `$`, lent for one hook's frame:
 * a spawn through them once that hook settled is refused (runtime/frame.ts).
 */
function ioOf($: EngineInterface, frame: Frame): Io {
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
      spawn: async input => {
        if (frame.isOpen()) return $.agent.spawn(input)
        $.ui.log(outsideFrame(frame.hook), { to: 'debug' })
        return { deny: outsideFrame(frame.hook) } as Awaited<ReturnType<typeof $.agent.spawn>>
      },
      list: () => $.agent.list(),
    },
    tool: {
      // Generated types enumerate the MCP tools connected at load; a dynamic mcp__ name is checked at runtime instead.
      call: input => $.tool.call(input as Parameters<typeof $.tool.call>[0]),
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

/** Runs a hook's body with ports whose spawns stand only until the body settles. */
function framed<T>($: EngineInterface, hook: string, body: (io: Io) => Promise<T>): Promise<T> {
  return withinFrame(hook, frame => body(ioOf($, frame)))
}

export const register: Register = (on, options) => {
  const ctx: Ctx = { options }
  const claim = claimLedger()
  // What zboard knows of its agents for `.catch` handlers, where `$` rejects (runtime/agent-cache.ts).
  const agents = agentCell()
  onAppend(async (_io, _before, after) => agents.set(withBoard(agents.get(), after)))
  onPlanAppend(async (_io, _before, after) => agents.set(withPlanAgents(agents.get(), after)))

  // Allowed-file guard (runtime/guard.ts), registered first so it sits above every other tool.call hook.
  // zboard spawns its agents only inside a hook frame (runtime/frame.ts), so their calls reach this
  // guard. Each `.catch` decides from the agent cache (runtime/reentry-guard.ts) and fails closed; it is
  // defense in depth only: live, the engine did not consult it for a re-entry-skipped call.
  on('tool.call', { tool: 'Edit' }, ($, e, next) => framed($, 'tool.call', async io => {
    const deny = await guardWrite(io, e.agentId, e.file_path)
    return deny === undefined ? next(e) : { deny }
  })).catch(async ($, e, next) => {
    const deny = caughtWrite(agents, e.tool, e.agentId, e.file_path, next)
    return deny === undefined ? next(e) : { deny }
  })
  on('tool.call', { tool: 'Write' }, ($, e, next) => framed($, 'tool.call', async io => {
    const deny = await guardWrite(io, e.agentId, e.file_path)
    return deny === undefined ? next(e) : { deny }
  })).catch(async ($, e, next) => {
    const deny = caughtWrite(agents, e.tool, e.agentId, e.file_path, next)
    return deny === undefined ? next(e) : { deny }
  })
  on('tool.call', { tool: 'NotebookEdit' }, ($, e, next) => framed($, 'tool.call', async io => {
    const deny = await guardWrite(io, e.agentId, e.notebook_path)
    return deny === undefined ? next(e) : { deny }
  })).catch(async ($, e, next) => {
    const deny = caughtWrite(agents, e.tool, e.agentId, e.notebook_path, next)
    return deny === undefined ? next(e) : { deny }
  })
  // Infrastructure guard (runtime/infra-guard.ts): a zboard agent's Bash may not run cloud or
  // infrastructure CLIs. Same frame and `.catch` rules as the write guard; the main session passes.
  on('tool.call', { tool: 'Bash' }, ($, e, next) => framed($, 'tool.call', async io => {
    const deny = await guardBash(io, e.agentId, e.command)
    return deny === undefined ? next(e) : { deny }
  })).catch(async ($, e, next) => {
    const deny = caughtBash(e.tool, e.agentId, e.command, next)
    return deny === undefined ? next(e) : { deny }
  })

  installEngramAllow(on)
  installAgentOffer(on)
  installOrchestrator(ctx)
  installPlanJobs()
  installPlanMirror()
  installMirrorWiring()
  installNotify()

  // The engine allows one unmatched hook per event, so session.start setup lives here:
  // registrations, then (once the session started) tasks.md polling and recovery, whose
  // relaunches spawn inside this frame.
  on('session.start', ($, e, next) => framed($, 'session.start', async io => {
    await registerAgentTypes(io)
    await registerPlanAgentTypes(io)
    await registerReadTools(io)
    await registerWriteTools(io)
    await registerCommand(io)
    await isolate(io, 'prefs.session.start', () => applyStoredPrefs(io), undefined)
    const started = await next(e)
    startPolling(io)
    await isolate(io, 'recovery.session.start', () => recover(io, ctx, true), undefined)
    await isolatePlan(io, 'plan.recovery', () => recoverPlan(io), undefined)
    await isolate(io, 'agents.session.start', () => refreshAgents(io, agents), undefined)
    return started
  }))

  // Watcher and recovery (runtime/watcher.ts, runtime/recovery.ts).
  on('classic.FileChanged', ($, e, next) => framed($, 'classic.FileChanged', async io => {
    const result = await next(e)
    await isolate(io, 'classic.FileChanged', () => fileChanged(io, ctx, e.file_path), undefined)
    return result
  }))
  on('classic.SessionStart', ($, e, next) => framed($, 'classic.SessionStart', async io => {
    const result = await next(e)
    const paths = await isolate(io, 'classic.SessionStart', () => watchPathsFor(io), [])
    return paths.length === 0 ? result : { ...result, watchPaths: [...(result.watchPaths ?? []), ...paths] }
  }))
  on('classic.PostCompact', ($, e, next) => framed($, 'classic.PostCompact', async io => {
    const result = await next(e)
    await isolate(io, 'classic.PostCompact', () => recover(io, ctx, false), undefined)
    await isolatePlan(io, 'plan.PostCompact', () => recoverPlan(io), undefined)
    return result
  }))
  on('classic.PreCompact', ($, e, next) => framed($, 'classic.PreCompact', async io => {
    await isolate(io, 'classic.PreCompact', () => flushMirror(io), undefined)
    await isolatePlan(io, 'plan.PreCompact', () => flushPlanMirror(io), undefined)
    return next(e)
  }))

  on('tool.call', { tool: 'mcp__zboard__board_status' }, $ => framed($, 'board_status', async io =>
    isolate(io, 'board_status', () => boardStatus(io), { deny: 'zboard: board_status failed' })))
  on('tool.call', { tool: 'mcp__zboard__board_task' }, ($, e) => framed($, 'board_task', async io =>
    isolate(io, 'board_task', () => boardTask(io, String(e.taskId ?? '')), { deny: 'zboard: board_task failed' })))
  on('tool.call', { tool: 'mcp__zboard__board_artifact' }, ($, e) => framed($, 'board_artifact', async io => {
    const answer = () => boardArtifact(io, String(e.taskId ?? ''), String(e.phase ?? ''))
    return isolate(io, 'board_artifact', answer, { deny: 'zboard: board_artifact failed' })
  }))
  on('tool.call', { tool: 'mcp__zboard__board_agent' }, ($, e) => framed($, 'board_agent', async io =>
    isolate(io, 'board_agent', () => boardAgent(io, String(e.agentId ?? '')), { deny: 'zboard: board_agent failed' })))

  // Board write tools (tools/board-write.ts).
  on('tool.call', { tool: 'mcp__zboard__board_create_task' }, ($, e) => framed($, 'board_create_task', async io =>
    isolate(io, 'board_create_task', () => createTaskTool(io, e), { deny: 'zboard: board_create_task failed' })))
  on('tool.call', { tool: 'mcp__zboard__board_comment' }, ($, e) => framed($, 'board_comment', async io =>
    isolate(io, 'board_comment', () => commentTool(io, e), { deny: 'zboard: board_comment failed' })))
  on('tool.call', { tool: 'mcp__zboard__board_move' }, ($, e) => framed($, 'board_move', async io =>
    isolate(io, 'board_move', () => moveTool(io, e), { deny: 'zboard: board_move failed' })))
  on('tool.call', { tool: 'mcp__zboard__board_assign' }, ($, e) => framed($, 'board_assign', async io =>
    isolate(io, 'board_assign', () => assignTool(io, e), { deny: 'zboard: board_assign failed' })))

  // `/zboard run` and the `/zboard changes` actions spawn inside this frame, awaited.
  on('command.run', { command: 'zboard' }, ($, e) => framed($, 'command.run', async io => {
    const text = await isolate(io, 'command.zboard', () => dispatch(io, ctx, parseArgs(e.args)), 'zboard: the command failed; see the board header.')
    return { text: unprefixed(text) }
  }))

  // Engine capture (runtime/capture.ts): the engine's own result always passes through.
  on('classic.SubagentStart', ($, e, next) => framed($, 'classic.SubagentStart', async io => {
    const result = await next(e)
    await isolate(io, 'agents.flush', () => flushPending(io, agents), undefined)
    await isolate(io, 'classic.SubagentStart', () => touch(io, e.agent_id), undefined)
    return result
  }))
  // A zboard agent's completion (runtime/complete.ts) from whichever of its SubagentStop and its
  // turn.complete reaches zboard first; the next phase or plan step spawns inside that frame.
  on('classic.SubagentStop', ($, e, next) => framed($, 'classic.SubagentStop', async io => {
    const result = await next(e)
    const end = { agentId: e.agent_id, text: e.last_assistant_message, transcriptPath: e.agent_transcript_path, effort: e.effort?.level }
    await isolate(io, 'classic.SubagentStop', () => completeAgent(io, ctx, end, claim), undefined)
    return result
  }))
  // The one unmatched tool.call hook: activity capture, then comment delivery (runtime/inject.ts),
  // which appends pending comments to the agent's next tool result as `context`. Its `.catch`
  // delivers from the agent cache (runtime/reentry-notes.ts), as defense in depth only.
  on('tool.call', ($, e, next) => {
    const agentId = e.agentId
    if (agentId === undefined) return next(e)
    return framed($, 'tool.call', async io => {
      await isolate(io, 'capture.tool.call', () => touch(io, agentId, e.tool), undefined)
      const found = await isolate(io, 'inject.tool.call', async () => noteFor(await readBoard(io), agentId), undefined)
      const ran = await next(e)
      if (found === undefined || ran.deny !== undefined) return ran
      await isolate(io, 'inject.deliver', () => append(io, found.events), undefined)
      return { ...ran, context: [...(ran.context ?? []), found.note] }
    })
  }).catch(async ($, e, next) => {
    const found = reentryNote(agents.get(), e.agentId, next)
    return deliverNote(agents, found, await next(e))
  })
  // A subagent's run is one turn: its turn.complete carries its agentId and, for a hand-back,
  // an empty answer (the report is read from its messages). It completes a zboard agent.
  on('turn.complete', ($, e, next) => framed($, 'turn.complete', async io => {
    await isolate(io, 'agents.flush', () => flushPending(io, agents), undefined)
    await isolate(io, 'capture.turn.complete', () => captureTokens(io, e.agentId, e.usage), undefined)
    await isolatePlan(io, 'plan.turn.complete', () => planTokens(io, e.agentId, e.usage), undefined)
    const result = await next(e)
    const agentId = e.agentId
    if (agentId !== undefined) await isolate(io, 'turn.complete.stop', () => completeAgent(io, ctx, { agentId, text: e.answer }, claim), undefined)
    await isolate(io, 'turn.complete.tick', () => tickIfDue(io, ctx), undefined)
    return result
  }))

  // A zboard agent's hand-back reaches the main session as a peer turn; zboard already took the
  // report, so the turn is dropped (runtime/handback-drop.ts). Its `.catch` makes the same
  // decision from the agent cache, as defense in depth.
  on('prompt.submit', async ($, e, next) => {
    const drop = handbackDrop(agents.get(), e)
    return drop === undefined ? next(e) : { drop }
  }).catch(async ($, e, next) => {
    const drop = caughtPrompt(agents.get(), e, next)
    return drop === undefined ? next(e) : { drop }
  })

  // Native task mirroring (runtime/native.ts): the native result is what the model sees.
  on('tool.call', { tool: 'TaskCreate' }, ($, e, next) => framed($, 'native.TaskCreate', async io => {
    const ran = await next(e)
    await isolate(io, 'native.TaskCreate', () => mirrorCreated(io, ran, e), undefined)
    return ran
  }))
  on('tool.call', { tool: 'TaskUpdate' }, ($, e, next) => framed($, 'native.TaskUpdate', async io => {
    const ran = await next(e)
    await isolate(io, 'native.TaskUpdate', () => mirrorUpdated(io, ran, e.taskId, e), undefined)
    return ran
  }))

  // The board pane (ui/Pane.tsx). Reading the atoms here subscribes the drawing to them. The ports
  // its closures hold outlive this frame, so they can never spawn: a press runs its work in the
  // ui.press hook below.
  on('ui.render', { component: 'Pane', requestId: 'zboard' }, ($, e) => framed($, 'ui.render', async io => {
    const board = boardOf((await read($, logAtom)) as LogState)
    const ui = (await read($, uiAtom)) as UiState
    const now = await $.clock.now()
    return renderPane($.ui.resolve(e), e.surface, io, { board, ui, now, columns: e.props.bodyColumns })
  }))
  // A Button press or an Input submit on any zboard element: core runs the element's closure
  // beneath `next(e)`, which only queues its work (runtime/press-work.ts); the work, and any
  // spawn it makes, then runs awaited inside this frame with this hook's ports.
  on('ui.press', { plugin: 'zboard' }, ($, e, next) => framed($, 'ui.press', async io => {
    const pressed = await next(e)
    await drainPressWork(io)
    await isolate(io, 'ui.press.tick', () => tickIfDue(io, ctx), undefined)
    return pressed
  }))
  on('ui.input', { plugin: 'zboard', kind: 'submit' }, ($, e, next) => framed($, 'ui.input', async io => {
    const submitted = await next(e)
    await drainPressWork(io)
    await isolate(io, 'ui.input.tick', () => tickIfDue(io, ctx), undefined)
    return submitted
  }))
  on('ui.focus', ($, e, next) => framed($, 'ui.focus', async io => {
    await isolate(io, 'ui.focus', () => focusCard(io, e.requestId, e.element), undefined)
    await isolatePlan(io, 'ui.focus.changes', () => focusChange(io, e.requestId, e.element), undefined)
    return next(e)
  }))

  // The task detail pane (ui/Detail.tsx); matchers name the pane id literally.
  on('ui.render', { component: 'Pane', requestId: 'zboard-detail' }, ($, e) => framed($, 'ui.render', async io => {
    const board = boardOf((await read($, logAtom)) as LogState)
    const ui = (await read($, uiAtom)) as UiState
    const artifacts = await read($, artifactsAtom)
    const now = await $.clock.now()
    return renderDetail($.ui.resolve(e), io, { board, ui, artifacts, now })
  }))
  on('ui.close', { id: 'zboard-detail' }, ($, e, next) => framed($, 'ui.close', async io => {
    await isolate(io, 'ui.close', () => closeDetail(io), undefined)
    return next(e)
  }))

  // The changes viewer (ui/ChangesPane.tsx). Reading the atoms here subscribes the drawing to them.
  on('ui.render', { component: 'Pane', requestId: 'zboard-changes' }, ($, e) => framed($, 'ui.render', async io => {
    const plan = planOf((await read($, planAtom)) as PlanLog)
    const ui = (await read($, uiAtom)) as UiState
    const selected = ui.changes.selected === null ? undefined : plan.changes[ui.changes.selected]
    const docs = await readDocs(io, selected)
    const root = await io.session.root()
    return renderChanges($.ui.resolve(e), e.surface, io, ctx, { plan, ui: ui.changes, docs, columns: e.props.bodyColumns, root })
  }))
  on('ui.close', { id: 'zboard-changes' }, ($, e, next) => framed($, 'ui.close', async io => {
    await isolatePlan(io, 'ui.close.changes', () => closeChanges(io), undefined)
    return next(e)
  }))
}
