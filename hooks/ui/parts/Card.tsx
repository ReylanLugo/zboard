import type { RenderElement } from 'claude-code'
import type { Io } from '../../runtime/io.ts'

import type { Task } from '../../domain/types.ts'
import { openDetail } from '../actions.ts'
import type { Els } from '../els.ts'
import { cardRows } from '../format.ts'
import { THEME, ink, statusColor } from '../theme.ts'

/** The status bar at a card's left edge, drawn in the status color. */
const MARKER = '▌'

/**
 * One task: a thin steel frame (bold blueprint when selected), a status marker
 * beside the focusable Button (Enter opens the detail), then its colored lines.
 */
export function Card(els: Els, io: Io, task: Task, now: number, isSelected: boolean): RenderElement {
  const { Box, Button, Text } = els
  return (
    <Box key={`box:${task.id}`} flexDirection="column" borderStyle={isSelected ? 'bold' : 'round'} borderColor={isSelected ? THEME.blueprint : THEME.steel} paddingX={1}>
      <Box key={`head:${task.id}`} flexDirection="row" gap={1}>
        <Box key={`mark:${task.id}`}><Text {...ink(statusColor(task.status))}>{MARKER}</Text></Box>
        <Button key={`card:${task.id}`} label={`${task.id} ${task.title}`} plain onPress={() => openDetail(io, task.id)} />
      </Box>
      {cardRows(task, now).map(row => <Text {...ink(row.color)} dimColor={row.dim === true}>{row.text}</Text>)}
    </Box>
  )
}
