import type { RenderElement } from 'claude-code'
import type { Io } from '../../runtime/io.ts'

import type { Task } from '../../domain/types.ts'
import { openDetail } from '../actions.ts'
import type { Els } from '../els.ts'
import { cardLines } from '../format.ts'

/** One task: a focusable Button (Enter opens the detail) and its stepper, chip, wait and decision lines. */
export function Card(els: Els, io: Io, task: Task, now: number, isSelected: boolean): RenderElement {
  const { Box, Button, Text } = els
  return (
    <Box key={`box:${task.id}`} flexDirection="column" borderStyle={isSelected ? 'bold' : 'round'} paddingX={1}>
      <Button key={`card:${task.id}`} label={`${task.id} ${task.title}`} plain onPress={() => openDetail(io, task.id)} />
      {cardLines(task, now).map(line => <Text>{line}</Text>)}
    </Box>
  )
}
