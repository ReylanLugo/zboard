import type { Io } from './io.ts'

import { loadChange, tasksPath } from '../adapters/openspec.ts'
import type { Ctx } from './ctx.ts'
import { append, readBoard, recordModError } from './log-store.ts'
import { tick } from './orchestrator.ts'
import { checkOpenChange } from './plan-catalog.ts'
import { recordPlanError } from './plan-store.ts'

export const POLL_MS = 5_000

let lastText: string | undefined

export async function checkTasksFile(io: Io, ctx: Ctx): Promise<void> {
  const board = await readBoard(io)
  if (board.changeId === null) return
  const loaded = await loadChange(io, board.changeId)
  if (!loaded.ok || loaded.text === lastText) return
  lastText = loaded.text
  await append(io, [{ type: 'ChangeLoaded', tasks: loaded.tasks }])
  await tick(io, ctx)
}

/** Polls tasks.md every POLL_MS; FileChanged only covers paths named at SessionStart. */
export function startPolling(io: Io, ctx: Ctx): void {
  io.clock.every(POLL_MS, () => {
    void checkTasksFile(io, ctx).catch(error => recordModError(io, 'watcher.poll', error))
    void checkOpenChange(io).catch(error => recordPlanError(io, 'watcher.plan', error))
  })
}

export async function fileChanged(io: Io, ctx: Ctx, path: string): Promise<void> {
  if (path.endsWith('/tasks.md')) await checkTasksFile(io, ctx)
  if (path.includes('/openspec/changes/')) await checkOpenChange(io)
}

/** The active change's tasks.md, for SessionStart's watchPaths. */
export async function watchPathsFor(io: Io): Promise<string[]> {
  const board = await readBoard(io)
  return board.changeId === null ? [] : [`${await io.session.root()}/${tasksPath(board.changeId)}`]
}
