import type { Io } from '../runtime/io.ts'

import type { Outcome } from '../domain/interactions.ts'
import { addComment, raisePriority, toggleBlock } from '../domain/interactions.ts'
import type { Board } from '../domain/types.ts'
import { DETAIL_ID } from '../runtime/ctx.ts'
import { append, readBoard } from '../runtime/log-store.ts'
import type { UiState } from '../runtime/ui-types.ts'
import { nextFilter } from './filter.ts'
import { PREFS_KEY, nextView } from './prefs.ts'

export async function setUi(io: Io, change: (ui: UiState) => UiState): Promise<UiState> {
  const next = await io.state.ui.update(change)
  await io.store.set(PREFS_KEY, { view: next.view, filter: next.filter }).catch(() => undefined)
  io.ui.invalidate()
  return next
}

export const cycleView = (io: Io): Promise<UiState> => setUi(io, ui => ({ ...ui, view: nextView(ui.view) }))

export async function cycleFilter(io: Io): Promise<UiState> {
  const board = await readBoard(io)
  return setUi(io, ui => ({ ...ui, filter: nextFilter(board, ui.filter) }))
}

export const select = (io: Io, taskId: string): Promise<UiState> => setUi(io, ui => ({ ...ui, selected: taskId }))

export async function startComment(io: Io): Promise<void> {
  const ui = await io.state.ui.read()
  if (ui.selected === null) {
    io.ui.toast('zboard: select a task first')
    return
  }
  await setUi(io, current => ({ ...current, composing: current.selected }))
}

export async function submitComment(io: Io, text: string): Promise<void> {
  const ui = await io.state.ui.read()
  if (ui.composing !== null) {
    const outcome = addComment(await readBoard(io), ui.composing, 'user', text, await io.clock.now())
    if (outcome.ok) await append(io, outcome.events)
  }
  await setUi(io, current => ({ ...current, composing: null }))
}

async function onSelected(io: Io, act: (board: Board, taskId: string) => Outcome): Promise<void> {
  const ui = await io.state.ui.read()
  if (ui.selected === null) {
    io.ui.toast('zboard: select a task first')
    return
  }
  const outcome = act(await readBoard(io), ui.selected)
  if (outcome.ok) await append(io, outcome.events)
  else io.ui.toast(`zboard: ${outcome.error}`)
}

export const toggleSelectedBlock = (io: Io): Promise<void> => onSelected(io, toggleBlock)
export const raiseSelected = (io: Io): Promise<void> => onSelected(io, raisePriority)

export async function openDetail(io: Io, taskId: string): Promise<void> {
  await setUi(io, ui => ({ ...ui, selected: taskId, detail: taskId, showArtifact: false }))
  await io.ui.open({ id: DETAIL_ID, title: `zboard ${taskId}`, focus: true, closeOnEscape: true })
}

export const toggleArtifact = (io: Io): Promise<UiState> => setUi(io, ui => ({ ...ui, showArtifact: !ui.showArtifact }))
