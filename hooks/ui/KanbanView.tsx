import type { RenderElement } from 'claude-code'
import type { Io } from '../runtime/io.ts'

import type { Task, TaskStatus } from '../domain/types.ts'
import type { Els, ViewProps } from './els.ts'
import { Card } from './parts/Card.tsx'

const WIDE_COLUMNS = 100

export const COLUMNS: readonly { readonly title: string; readonly statuses: readonly TaskStatus[] }[] = [
  { title: 'Ready', statuses: ['backlog', 'ready'] },
  { title: 'Running', statuses: ['running'] },
  { title: 'Review', statuses: ['review'] },
  { title: 'Decision', statuses: ['needs_decision', 'blocked'] },
  { title: 'Done', statuses: ['done'] },
]

export function KanbanView(els: Els, io: Io, tasks: readonly Task[], props: ViewProps): RenderElement {
  const { Box, Text } = els
  const isWide = props.columns >= WIDE_COLUMNS
  return (
    <Box key="kanban" flexDirection={isWide ? 'row' : 'column'} gap={1}>
      {COLUMNS.map(column => {
        const cards = tasks.filter(task => column.statuses.includes(task.status))
        return (
          <Box key={`column:${column.title}`} flexDirection="column" flexGrow={1}>
            <Text bold>{`${column.title} (${cards.length})`}</Text>
            {cards.map(task => Card(els, io, task, props.now, task.id === props.ui.selected))}
          </Box>
        )
      })}
    </Box>
  )
}
