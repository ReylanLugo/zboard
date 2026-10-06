import type { Io } from './io.ts'

import { archiveCli } from '../adapters/openspec-cli.ts'
import { actionsFor } from '../plan/lifecycle.ts'
import { RETRO_ARTIFACT, isPlanChangeName } from '../plan/types.ts'
import type { Ctx } from './ctx.ts'
import { refreshChanges } from './plan-catalog.ts'
import { startJob } from './plan-runner.ts'
import { appendPlan, readPlan } from './plan-store.ts'

/** D13.7: the retrospective is drafted after a passed verify run and accepted through a diff (RetrospectiveAccepted). */
export async function draftRetrospective(io: Io, ctx: Ctx, changeId: string): Promise<boolean> {
  const gate = actionsFor((await readPlan(io)).changes[changeId]).retrospective
  if (!gate.enabled) {
    io.ui.toast(`zboard: ${gate.reason}`)
    return false
  }
  return startJob(io, ctx, changeId, { kind: 'draft', artifact: RETRO_ARTIFACT })
}

/** D14: `openspec archive <id> --yes --json`, the only writer of openspec/specs/. */
export async function archiveChange(io: Io, changeId: string): Promise<boolean> {
  if (!isPlanChangeName(changeId)) {
    io.ui.toast(`zboard: invalid change name: ${changeId}`)
    return false
  }
  const gate = actionsFor((await readPlan(io)).changes[changeId]).archive
  if (!gate.enabled) {
    io.ui.toast(`zboard: archive is disabled — ${gate.reason}`)
    return false
  }
  await appendPlan(io, [{ type: 'ArchiveStarted', changeId }])
  const out = await archiveCli(io, changeId)
  if (!out.ok) {
    await appendPlan(io, [{ type: 'PlanError', changeId, hook: 'archive', message: out.output }])
    io.ui.toast(`zboard: openspec archive failed: ${out.output}`)
    return false
  }
  await appendPlan(io, [{ type: 'ChangeArchived', changeId }])
  await refreshChanges(io)
  return true
}
