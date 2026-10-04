import type { RenderElement } from 'claude-code'
import type { Io } from '../runtime/io.ts'

import { PANE_ID } from '../runtime/ctx.ts'
import { cycleFilter, cycleView, raiseSelected, select, startComment, submitComment, toggleSelectedBlock } from './actions.ts'
import type { Els, ViewProps } from './els.ts'
import { filterLabel, visibleTasks } from './filter.ts'
import { headerLine } from './format.ts'
import { KanbanView } from './KanbanView.tsx'
import { SwimlaneView } from './SwimlaneView.tsx'

const EMPTY_HINT = 'No change loaded. Run /zboard run <change> to start.'
const CARD_PREFIX = 'card:'

function Toolbar(els: Els, io: Io, props: ViewProps): RenderElement {
  const { Box, Button } = els
  return (
    <Box key="toolbar" flexDirection="row" gap={1}>
      <Button key="view" label="view" hotkey="v" onPress={() => void cycleView(io)} />
      <Button key="filter" label={`filter: ${filterLabel(props.ui.filter)}`} hotkey="f" onPress={() => void cycleFilter(io)} />
      <Button key="comment" label="comment" hotkey="c" onPress={() => void startComment(io)} />
      <Button key="block" label="block" hotkey="b" onPress={() => void toggleSelectedBlock(io)} />
      <Button key="priority" label="priority" hotkey="p" onPress={() => void raiseSelected(io)} />
    </Box>
  )
}

function Body(els: Els, io: Io, props: ViewProps): RenderElement {
  const { Box, Text } = els
  if (props.board.changeId === null) return <Box key="empty"><Text dimColor>{EMPTY_HINT}</Text></Box>
  const tasks = visibleTasks(props.board, props.ui.filter)
  switch (props.ui.view) {
    case 'swimlane':
      return SwimlaneView(els, io, tasks, props)
    default:
      return KanbanView(els, io, tasks, props)
  }
}

function BoardPane(els: Els, io: Io, props: ViewProps): RenderElement {
  const { Box, Input, Text } = els
  return (
    <Box flexDirection="column">
      <Box key="header"><Text bold>{headerLine(props.board, props.ui.view)}</Text></Box>
      {Toolbar(els, io, props)}
      {props.ui.composing === null ? null : (
        <Input key="comment-input" label={`comment on ${props.ui.composing}`} placeholder="type, then Enter" autoFocus onSubmit={value => void submitComment(io, value)} />
      )}
      {Body(els, io, props)}
    </Box>
  )
}

/**
 * Draws the board pane. Its `ui.render` hook lives in register.tsx, which reads
 * the state atoms (subscribing the drawing) and passes the values here; every
 * write happens later in a press, input or focus handler.
 */
export function renderPane(els: unknown, surface: string, io: Io, props: ViewProps): RenderElement {
  if (surface !== 'terminal' && surface !== 'desktop') {
    const { Text } = els as Els
    return <Text>{headerLine(props.board, props.ui.view)}</Text>
  }
  return BoardPane(els as Els, io, props)
}

/** A focus on a card selects its task. */
export async function focusCard(io: Io, requestId: string, element: string | undefined): Promise<void> {
  if (requestId === PANE_ID && element?.startsWith(CARD_PREFIX) === true) await select(io, element.slice(CARD_PREFIX.length))
}
