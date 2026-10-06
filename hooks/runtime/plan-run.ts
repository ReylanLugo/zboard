import type { Io } from './io.ts'

import { dispatch } from '../commands/zboard.ts'
import { actionsFor } from '../plan/lifecycle.ts'
import type { Ctx } from './ctx.ts'
import { readBoard } from './log-store.ts'
import { appendPlan, readPlan } from './plan-store.ts'

/** ▶ Run: readiness-gated, then the unchanged `/zboard run <change>` path (D2 executing). */
export async function runChange(io: Io, ctx: Ctx, changeId: string): Promise<string> {
  const rec = (await readPlan(io)).changes[changeId]
  const gate = actionsFor(rec).run
  if (rec === undefined || !gate.enabled) {
    const text = `zboard: not ready to run ${changeId} — ${gate.reason}`
    io.ui.toast(text)
    return text
  }
  const text = await dispatch(io, ctx, { kind: 'run', changeId })
  // `/zboard run` answers a refusal as text; only a board now running this change counts as started.
  const board = await readBoard(io)
  if (!board.running || board.changeId !== changeId) {
    io.ui.toast(text)
    return text
  }
  await appendPlan(io, [{ type: 'RunStarted', changeId }])
  return text
}
