import type { RenderElement } from 'claude-code'
import type { Io } from '../runtime/io.ts'

import type { Task, TaskStatus } from '../domain/types.ts'
import { openDetail } from './actions.ts'
import type { Els, ViewProps } from './els.ts'
import { stepper } from './format.ts'
import { THEME, ink, statusColor } from './theme.ts'

const ICON: Readonly<Record<TaskStatus, string>> = {
  backlog: '·', ready: '○', running: '●', review: '◐', needs_decision: '⚠', blocked: '⛔', done: '✓',
}
const sectionOf = (task: Task): string => task.section || 'Board'

export function TreeView(els: Els, io: Io, tasks: readonly Task[], props: ViewProps): RenderElement {
  const { Box, Button, Text } = els
  const sections = [...new Set(tasks.map(sectionOf))]
  return (
    <Box key="tree" flexDirection="column">
      <Text bold>{props.board.changeId ?? ''}</Text>
      {sections.map(section => (
        <Box key={`section:${section}`} flexDirection="column" paddingLeft={1}>
          <Text bold color={THEME.blueprint}>{`▾ ${section}`}</Text>
          {tasks.filter(task => sectionOf(task) === section).map(task => (
            <Box key={`row:${task.id}`} flexDirection="row" gap={1} paddingLeft={2}>
              <Text {...ink(statusColor(task.status))}>{ICON[task.status]}</Text>
              <Button key={`card:${task.id}`} label={`${task.id} ${task.title}`} plain onPress={() => void openDetail(io, task.id)} />
              <Text dimColor>{stepper(task)}</Text>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  )
}
