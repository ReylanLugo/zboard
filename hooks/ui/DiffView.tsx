import type { RenderElement } from 'claude-code'
import type { Io } from '../runtime/io.ts'

import { unifiedDiff } from '../plan/diff.ts'
import type { ChangeRecord, DiffProposal } from '../plan/types.ts'
import type { Ctx } from '../runtime/ctx.ts'
import { acceptProposal, regenerateProposal, rejectProposal } from '../runtime/plan-apply.ts'
import { act, startCompose } from './changes-actions.ts'
import type { Els } from './els.ts'
import { keyed } from './format.ts'
import { THEME, diffLineColor, ink } from './theme.ts'

/** Diff lines drawn per proposal file; a longer diff ends with a count of the lines left out. */
const DIFF_LINES_MAX = 400

/**
 * One file's unified diff as per-line Text rows in a steel frame (the engine's
 * Code element colors a diff in its own palette, never the plugin's):
 * `+` moss, `-` brick, hunk headers blueprint, context in the default ink.
 */
function DiffLines(els: Els, path: string, diff: string): RenderElement {
  const { Box, Text } = els
  const lines = diff.split('\n').filter((line, index, all) => line !== '' || index < all.length - 1)
  const shown = lines.slice(0, DIFF_LINES_MAX)
  return (
    <Box key={`diff-body:${path}`} flexDirection="column" borderStyle="round" borderColor={THEME.steel} paddingX={1}>
      {shown.map(line => <Text {...ink(diffLineColor(line))}>{line === '' ? ' ' : line}</Text>)}
      {lines.length > shown.length ? <Text dimColor>{`… ${lines.length - shown.length} more lines`}</Text> : null}
    </Box>
  )
}

/** D15 diff view: one unified diff per file; a stale proposal can only be regenerated or rejected. */
export function DiffView(els: Els, io: Io, ctx: Ctx, rec: ChangeRecord, proposal: DiffProposal): RenderElement {
  const { Box, Button, Text } = els
  const isStale = proposal.status === 'stale'
  return (
    <Box key="diff" flexDirection="column">
      <Box key="diff-title"><Text bold color={isStale ? THEME.signal : THEME.blueprint}>{`Proposal · ${proposal.artifact}${isStale ? ' · stale: the files changed since it was drafted' : ''}`}</Text></Box>
      <Box key="diff-reason"><Text dimColor>{proposal.reason}</Text></Box>
      {proposal.files.map(file => (
        <Box key={`diff:${file.path}`} flexDirection="column">
          <Text>{file.before === null ? `${file.path} (new file)` : file.path}</Text>
          {DiffLines(els, file.path, unifiedDiff(file.path, file.before, file.after))}
        </Box>
      ))}
      <Box key="diff-actions" flexDirection="row" gap={1}>
        {isStale
          ? <Button key="regenerate" label="regenerate" variant="primary" onPress={act(io, rec, 'regenerate', () => regenerateProposal(io, ctx, rec.id))} />
          : <Button key="accept" {...keyed('a', 'accept')} variant="primary" onPress={act(io, rec, 'accept', () => acceptProposal(io, ctx, rec.id))} />}
        <Button key="reject" {...keyed('z', 'reject')} onPress={act(io, rec, 'reject', () => rejectProposal(io, rec.id))} />
        <Button key="another" label="ask another version" onPress={act(io, rec, 'another', () => startCompose(io, 'note'))} />
      </Box>
    </Box>
  )
}
