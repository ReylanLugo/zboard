import type { Io } from '../runtime/io.ts'

import { actionsFor } from '../plan/lifecycle.ts'
import type { Ctx } from '../runtime/ctx.ts'
import { askAnother } from '../runtime/plan-apply.ts'
import { createChange } from '../runtime/plan-catalog.ts'
import { commentOn } from '../runtime/plan-draft.ts'
import { isolatePlan, readPlan } from '../runtime/plan-store.ts'
import { pressWork } from '../runtime/press-work.ts'
import type { ChangesTab, ChangesUi, ComposeKind } from '../runtime/ui-types.ts'
import type { ChangeRecord } from '../plan/types.ts'
import { defaultArtifact } from './changes-model.ts'

/**
 * A press's closure: it queues the work for zboard's ui.press hook, which runs it with its own
 * ports inside its frame (runtime/press-work.ts). The work runs isolated: a failure becomes a
 * PlanError on the change (D16), never a broken pane.
 */
export const act = (rec: ChangeRecord, name: string, work: (io: Io) => Promise<unknown>) => (): void => {
  pressWork(io => isolatePlan(io, `ui.${name}`, async () => { await work(io) }, undefined, rec.id))
}

export async function setChanges(io: Io, change: (ui: ChangesUi) => ChangesUi): Promise<void> {
  await io.state.ui.update(ui => ({ ...ui, changes: change(ui.changes) }))
  io.ui.invalidate()
}

export const selectChange = (io: Io, id: string): Promise<void> => setChanges(io, ui => ({ ...ui, selected: id, artifact: null }))
export const setTab = (io: Io, tab: ChangesTab): Promise<void> => setChanges(io, ui => ({ ...ui, tab }))
export const selectArtifact = (io: Io, artifact: string): Promise<void> => setChanges(io, ui => ({ ...ui, artifact }))
export const startCompose = (io: Io, kind: ComposeKind): Promise<void> => setChanges(io, ui => ({ ...ui, composing: kind }))
export const toggleRaw = (io: Io): Promise<void> => setChanges(io, ui => ({ ...ui, showRaw: !ui.showRaw }))

export async function composeComment(io: Io, changeId: string): Promise<void> {
  const gate = actionsFor((await readPlan(io)).changes[changeId]).comment
  if (!gate.enabled) {
    io.ui.toast(`zboard: ${gate.reason}`)
    return
  }
  await startCompose(io, 'comment')
}

/** The pane's one text input: a new change id, a comment, or an ask-another note. */
export async function submitCompose(io: Io, ctx: Ctx, value: string): Promise<void> {
  const ui = (await io.state.ui.read()).changes
  await setChanges(io, current => ({ ...current, composing: null }))
  const text = value.trim()
  if (text === '' || ui.composing === null) return
  if (ui.composing === 'new') {
    const outcome = await createChange(io, text)
    io.ui.toast(outcome)
    if (outcome === `zboard: created ${text}`) await selectChange(io, text)
    return
  }
  if (ui.selected === null) return
  if (ui.composing === 'note') {
    await askAnother(io, ctx, ui.selected, text)
    return
  }
  const rec = (await readPlan(io)).changes[ui.selected]
  await commentOn(io, ctx, ui.selected, ui.artifact ?? (rec === undefined ? '' : defaultArtifact(rec)), text)
}
