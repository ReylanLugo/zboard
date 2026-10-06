import type { RenderElement } from 'claude-code'
import type { Io } from '../runtime/io.ts'

import { ALLOWED } from '../plan/findings.ts'
import { forecastLines } from '../plan/forecast.ts'
import type { ActionGate } from '../plan/lifecycle.ts'
import { actionsFor } from '../plan/lifecycle.ts'
import type { ChangeRecord, Forecast } from '../plan/types.ts'
import type { Ctx } from '../runtime/ctx.ts'
import { archiveChange, draftRetrospective } from '../runtime/plan-archive.ts'
import { findingToComment } from '../runtime/plan-critique.ts'
import { confirmForecast, dismissForecast } from '../runtime/plan-forecast.ts'
import { retryJob } from '../runtime/plan-runner.ts'
import { isolatePlan } from '../runtime/plan-store.ts'
import { proposeVerifyMd, rejudge, resolveFinding, verifyChange } from '../runtime/plan-verify.ts'
import { act } from './changes-actions.ts'
import type { Els } from './els.ts'

export function VerifyTab(els: Els, io: Io, ctx: Ctx, rec: ChangeRecord): RenderElement {
  const { Box, Button, Text } = els
  const gates = actionsFor(rec)
  const findings = rec.verify?.findings ?? []
  const control = (key: string, label: string, gate: ActionGate, work: () => Promise<unknown>): RenderElement =>
    <Button key={key} label={label} dimColor={!gate.enabled} onPress={act(io, rec, key, work)} />
  return (
    <Box key="tab-verify" flexDirection="column">
      <Box key="verify-state"><Text bold>{rec.verify === undefined ? 'No verify run yet.' : `verify run ${rec.verify.runs} · ${rec.verify.passed ? 'passed' : 'not passed'}`}</Text></Box>
      {findings.map(f => (
        <Box key={`finding:${f.id}`} flexDirection="column">
          <Text>{`${f.requirement}${f.scenario === undefined ? '' : ` / ${f.scenario}`} · ${f.verdict}${f.resolution === undefined ? '' : ` → ${f.resolution}`}${f.linkedTask === undefined ? '' : ` (task ${f.linkedTask})`}`}</Text>
          <Text dimColor>{(Array.isArray(f.evidence) ? f.evidence.join('; ') : '') || 'no evidence'}</Text>
          {f.verdict === 'true' || f.resolution !== undefined ? null : (
            <Box key={`resolutions:${f.id}`} flexDirection="row" gap={1}>
              {(ALLOWED[f.verdict] ?? []).map(resolution => (
                <Button key={`resolve:${f.id}:${resolution}`} label={resolution.replace('_', ' ')} onPress={act(io, rec, 'resolve', () => resolveFinding(io, ctx, rec.id, f.id, resolution))} />
              ))}
            </Box>
          )}
        </Box>
      ))}
      <Box key="verify-actions" flexDirection="row" gap={1} flexWrap="wrap">
        {control('verify', 'verify', gates.verify, () => verifyChange(io, ctx, rec.id))}
        {control('rejudge', 're-judge', gates.rejudge, () => rejudge(io, ctx, rec.id))}
        {control('verify-md', 'write verify.md', { enabled: rec.verify?.passed === true, reason: 'the verify run has not passed' }, () => proposeVerifyMd(io, rec.id))}
        {control('retrospective', 'retrospective', gates.retrospective, () => draftRetrospective(io, ctx, rec.id))}
        {control('archive', 'archive', gates.archive, () => archiveChange(io, rec.id))}
      </Box>
      {gates.archive.enabled ? null : <Box key="archive-reason"><Text dimColor>{`archive: ${gates.archive.reason}`}</Text></Box>}
    </Box>
  )
}

export function ForecastView(els: Els, io: Io, ctx: Ctx, forecast: Forecast): RenderElement {
  const { Box, Button, Text } = els
  return (
    <Box key="forecast" flexDirection="column">
      <Box key="forecast-title"><Text bold>Plan step forecast — nothing runs until you confirm</Text></Box>
      {forecastLines(forecast).map((line, index) => <Box key={`forecast-line:${index}`}><Text>{line}</Text></Box>)}
      <Box key="forecast-actions" flexDirection="row" gap={1}>
        <Button key="forecast-confirm" label="draft the plan" variant="primary" onPress={() => void isolatePlan(io, 'ui.forecast', async () => { await confirmForecast(io, ctx) }, undefined, forecast.changeId)} />
        <Button key="forecast-dismiss" label="not now" onPress={() => void dismissForecast(io)} />
      </Box>
    </Box>
  )
}

export function CritiqueList(els: Els, io: Io, ctx: Ctx, rec: ChangeRecord): RenderElement[] {
  const { Box, Button, Text } = els
  return (rec.critique ?? []).map((finding, index) => (
    <Box key={`critique:${index}`} flexDirection="row" gap={1}>
      <Text>{`${finding.severity} · ${finding.artifact} · ${finding.issue} — ${finding.suggestion}`}</Text>
      <Button key={`critique-comment:${index}`} label="comment" onPress={act(io, rec, 'critique.comment', () => findingToComment(io, ctx, rec.id, index))} />
    </Box>
  ))
}

export function RetryView(els: Els, io: Io, ctx: Ctx, rec: ChangeRecord): RenderElement[] {
  const { Box, Button, Text } = els
  const retryable = rec.retryable
  if (retryable === undefined || rec.activeAgent !== undefined) return []
  return [
    <Box key="retry-row" flexDirection="row" gap={1}>
      <Text>{`${retryable.role} stopped without a valid answer`}</Text>
      <Button key="retry" label={`retry ${retryable.role}`} onPress={act(io, rec, 'retry', () => retryJob(io, ctx, rec.id))} />
    </Box>,
  ]
}
