import type { RenderElement } from 'claude-code'

import type { AgentRun } from '../../domain/types.ts'
import type { Els } from '../els.ts'
import { chipText, heartbeat } from '../format.ts'
import { roleColor } from '../theme.ts'

export function AgentChip(els: Els, run: AgentRun, now: number): RenderElement {
  const { Text } = els
  return <Text color={roleColor(run.role)} dimColor={run.endedAt !== undefined}>{`${heartbeat(run, now)} ${chipText(run, now)}`}</Text>
}
