import type { Io } from './io.ts'

import { loadChange, tasksPath } from '../adapters/openspec.ts'
import type { Ctx } from './ctx.ts'
import { append, readBoard, recordModError } from './log-store.ts'
import { requestTick, tick, tickIfDue } from './orchestrator.ts'
import { checkOpenChange } from './plan-catalog.ts'
import { recordPlanError } from './plan-store.ts'

export const POLL_MS = 5_000

let lastText: string | undefined

/** Reloads the active change's tasks.md into the board when its text changed; true when it did. */
async function reloadTasks(io: Io): Promise<boolean> {
  const board = await readBoard(io)
  if (board.changeId === null) return false
  const loaded = await loadChange(io, board.changeId)
  if (!loaded.ok || loaded.text === lastText) return false
  lastText = loaded.text
  await append(io, [{ type: 'ChangeLoaded', tasks: loaded.tasks }])
  return true
}

/** From a hook frame: reloads tasks.md and starts what became runnable, awaited. */
export async function checkTasksFile(io: Io, ctx: Ctx): Promise<void> {
  if (await reloadTasks(io)) await tick(io, ctx)
}

/**
 * Polls tasks.md every POLL_MS; FileChanged only covers paths named at SessionStart.
 * A timer may not spawn (runtime/frame.ts), so a reload only marks a tick due; the
 * next hook frame (turn.complete, a press, FileChanged) runs it.
 */
export function startPolling(io: Io): void {
  io.clock.every(POLL_MS, () => {
    void reloadTasks(io).then(changed => { if (changed) requestTick() }).catch(error => recordModError(io, 'watcher.poll', error))
    void checkOpenChange(io).catch(error => recordPlanError(io, 'watcher.plan', error))
  })
}

export async function fileChanged(io: Io, ctx: Ctx, path: string): Promise<void> {
  if (path.endsWith('/tasks.md')) await checkTasksFile(io, ctx)
  if (path.includes('/openspec/changes/')) await checkOpenChange(io)
  await tickIfDue(io, ctx)
}

/** The active change's tasks.md, for SessionStart's watchPaths. */
export async function watchPathsFor(io: Io): Promise<string[]> {
  const board = await readBoard(io)
  return board.changeId === null ? [] : [`${await io.session.root()}/${tasksPath(board.changeId)}`]
}
