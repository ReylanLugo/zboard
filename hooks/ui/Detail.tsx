import type { RenderElement } from 'claude-code'

import type { Board } from '../domain/types.ts'
import { DETAIL_ID } from '../runtime/ctx.ts'
import type { Io } from '../runtime/io.ts'
import type { UiState } from '../runtime/ui-types.ts'
import { setUi, toggleArtifact } from './actions.ts'
import { detailSections, latestArtifactKey } from './detail-model.ts'
import type { Els } from './els.ts'
import { ink, statusColor } from './theme.ts'

const ARTIFACT_PREVIEW_CHARS = 4_000

export interface DetailProps {
  readonly board: Board
  readonly ui: UiState
  readonly artifacts: Readonly<Record<string, string>>
  readonly now: number
}

/**
 * Draws the task detail pane. Its `ui.render` hook lives in register.tsx, which
 * reads the state atoms (subscribing the drawing) and passes the values here.
 */
export function renderDetail(els: unknown, io: Io, props: DetailProps): RenderElement {
  const { Box, Button, Text } = els as Els
  const { board, ui, artifacts, now } = props
  const task = ui.detail === null ? undefined : board.tasks[ui.detail]
  if (task === undefined) return <Box key="detail-empty"><Text>No task selected.</Text></Box>
  const key = latestArtifactKey(task)
  const artifact = key === undefined ? undefined : artifacts[key]
  const title = `${task.id} ${task.title} — ${task.status}${task.phase === null ? '' : ` (${task.phase})`}`
  return (
    <Box flexDirection="column">
      <Box key="detail-title"><Text bold {...ink(statusColor(task.status))}>{title}</Text></Box>
      {detailSections(task, now).map(section => (
        <Box key={`detail:${section.title}`} flexDirection="column">
          <Text bold>{section.title}</Text>
          {section.lines.map(line => <Text>{line}</Text>)}
        </Box>
      ))}
      <Box key="detail-actions" flexDirection="row" gap={1}>
        <Button key="artifact" label={ui.showArtifact ? 'hide artifact' : 'full artifact'} hotkey="a" onPress={() => void toggleArtifact(io)} />
        <Button key="back" label="back" role="dismiss" onPress={() => void io.ui.close({ id: DETAIL_ID })} />
      </Box>
      {ui.showArtifact ? (
        <Box key="artifact-text">
          <Text>{artifact === undefined ? '(no artifact stored in this session)' : artifact.slice(0, ARTIFACT_PREVIEW_CHARS)}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

/** Closing the detail pane clears the detail selection. */
export async function closeDetail(io: Io): Promise<void> {
  await setUi(io, ui => ({ ...ui, detail: null, showArtifact: false }))
}
