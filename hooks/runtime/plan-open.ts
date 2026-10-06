import type { Io } from './io.ts'

import { isPlanChangeName } from '../plan/types.ts'
import { CHANGES_ID } from './ctx.ts'
import { refreshChanges } from './plan-catalog.ts'
import { restoreMirrors } from './plan-recovery.ts'

/** `/zboard changes [<id>]` and the board's `o` key. User-opened, so it seats at any width. */
export async function openChanges(io: Io, changeId?: string): Promise<string> {
  if (changeId !== undefined && !isPlanChangeName(changeId)) return `zboard: invalid change name: ${changeId}`
  const board = await refreshChanges(io)
  await restoreMirrors(io, board.order)
  const current = (await io.state.ui.read()).changes.selected
  const selected = changeId ?? current ?? board.order.find(id => board.changes[id]?.listed === true) ?? null
  await io.state.ui.update(ui => ({ ...ui, changes: { ...ui.changes, selected } }))
  if (changeId !== undefined && board.changes[changeId] === undefined) io.ui.toast(`zboard: no change named ${changeId}`)
  const opened = await io.ui.open({ id: CHANGES_ID, title: 'zboard changes', focus: true, closeOnEscape: true })
  return opened.isPlaced ? 'zboard: changes opened.' : `zboard: the changes viewer waits to be placed (${opened.reason}).`
}
