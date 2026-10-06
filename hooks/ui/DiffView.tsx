import type { RenderElement } from 'claude-code'
import type { Io } from '../runtime/io.ts'

import { unifiedDiff } from '../plan/diff.ts'
import type { ChangeRecord, DiffProposal } from '../plan/types.ts'
import type { Ctx } from '../runtime/ctx.ts'
import { acceptProposal, regenerateProposal, rejectProposal } from '../runtime/plan-apply.ts'
import { act, startCompose } from './changes-actions.ts'
import type { Els } from './els.ts'

/** D15 diff view: one unified diff per file; a stale proposal can only be regenerated or rejected. */
export function DiffView(els: Els, io: Io, ctx: Ctx, rec: ChangeRecord, proposal: DiffProposal): RenderElement {
  const { Box, Button, Code, Text } = els
  const isStale = proposal.status === 'stale'
  return (
    <Box key="diff" flexDirection="column">
      <Box key="diff-title"><Text bold>{`Proposal · ${proposal.artifact}${isStale ? ' · stale: the files changed since it was drafted' : ''}`}</Text></Box>
      <Box key="diff-reason"><Text dimColor>{proposal.reason}</Text></Box>
      {proposal.files.map(file => (
        <Box key={`diff:${file.path}`} flexDirection="column">
          <Text>{file.before === null ? `${file.path} (new file)` : file.path}</Text>
          <Code source={unifiedDiff(file.path, file.before, file.after)} format="diff" path={file.path} />
        </Box>
      ))}
      <Box key="diff-actions" flexDirection="row" gap={1}>
        {isStale
          ? <Button key="regenerate" label="regenerate" variant="primary" onPress={act(io, rec, 'regenerate', () => regenerateProposal(io, ctx, rec.id))} />
          : <Button key="accept" label="accept" hotkey="a" variant="primary" onPress={act(io, rec, 'accept', () => acceptProposal(io, ctx, rec.id))} />}
        <Button key="reject" label="reject" hotkey="z" onPress={act(io, rec, 'reject', () => rejectProposal(io, rec.id))} />
        <Button key="another" label="ask another version" onPress={act(io, rec, 'another', () => startCompose(io, 'note'))} />
      </Box>
    </Box>
  )
}
