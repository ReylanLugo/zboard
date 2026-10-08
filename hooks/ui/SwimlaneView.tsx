import type { RenderElement } from 'claude-code'
import type { Io } from '../runtime/io.ts'

import { activeRun } from '../domain/project.ts'
import type { AgentRun, Role, Task } from '../domain/types.ts'
import { ROLES, agentTypeOf } from '../domain/types.ts'
import { openDetail } from './actions.ts'
import type { Els, ViewProps } from './els.ts'
import { chipText, heartbeat } from './format.ts'
import { heartbeatColor, roleColor } from './theme.ts'

const FAILED = new Set(['error', 'interrupted'])

/** Active runs of a role, plus a task's last run when it ended in error, so red heartbeats stay visible. */
const runsOf = (tasks: readonly Task[], role: Role): { task: Task; run: AgentRun }[] =>
  tasks.flatMap(task => task.agents
    .filter(run => run.role === role && (run.endedAt === undefined || (run === task.agents.at(-1) && run.outcome !== undefined && FAILED.has(run.outcome))))
    .map(run => ({ task, run })))

const queued = (tasks: readonly Task[]): Task[] =>
  tasks.filter(task => task.waitReason !== undefined || (task.pending !== undefined && activeRun(task) === undefined))

export function SwimlaneView(els: Els, io: Io, tasks: readonly Task[], props: ViewProps): RenderElement {
  const { Box, Button, Text } = els
  return (
    <Box key="swimlanes" flexDirection="column" gap={1}>
      {ROLES.map(role => {
        const runs = runsOf(tasks, role)
        return (
          <Box key={`lane:${role}`} flexDirection="column">
            <Text bold color={roleColor(role)}>{`${agentTypeOf(role)} (${runs.length})`}</Text>
            {runs.map(({ task, run }) => (
              <Box key={`run:${run.agentId}`} flexDirection="column">
                <Button key={`card:${task.id}`} label={`${heartbeat(run, props.now)} ${task.id} ${task.title}`} plain onPress={() => void openDetail(io, task.id)} />
                <Text color={heartbeatColor(heartbeat(run, props.now))}>{chipText(run, props.now)}</Text>
              </Box>
            ))}
          </Box>
        )
      })}
      <Box key="queue" flexDirection="column">
        <Text bold>Queue</Text>
        {queued(tasks).map(task => (
          <Box key={`wait:${task.id}`}><Text>{`⏸ ${task.id} ${task.waitReason ?? `next: ${task.pending?.phase ?? 'start'}`}`}</Text></Box>
        ))}
      </Box>
    </Box>
  )
}
