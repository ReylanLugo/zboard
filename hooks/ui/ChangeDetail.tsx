import type { RenderElement } from 'claude-code'
import type { Io } from '../runtime/io.ts'

import { readableError } from '../plan/errors.ts'
import { actionsFor } from '../plan/lifecycle.ts'
import type { ChangeRecord } from '../plan/types.ts'
import type { Ctx } from '../runtime/ctx.ts'
import { draftNext } from '../runtime/plan-actions.ts'
import { critiqueChange } from '../runtime/plan-critique.ts'
import type { ChangeDocs, DocFile } from '../runtime/plan-docs.ts'
import { clipMarkdown } from '../runtime/plan-docs.ts'
import { explainChange, isExplanationCurrent } from '../runtime/plan-explain.ts'
import { repairTasks } from '../runtime/plan-draft.ts'
import { runChange } from '../runtime/plan-run.ts'
import type { ChangesTab, ChangesUi } from '../runtime/ui-types.ts'
import { CHANGES_TABS } from '../runtime/ui-types.ts'
import { act, composeComment, selectArtifact, setTab } from './changes-actions.ts'
import { READINESS_PENDING, defaultArtifact, historyRows, offersRepair, isPlanPending, readinessLine, stepperMarks, uncoveredRequirements } from './changes-model.ts'
import { DiagramsTab } from './DiagramsTab.tsx'
import { keyed, readinessFailureLine } from './format.ts'
import { DiffView } from './DiffView.tsx'
import { QaView, showsQa } from './QaView.tsx'
import { CritiqueList, ForecastView, RetryView, VerifyTab } from './VerifyTab.tsx'
import type { Els } from './els.ts'
import { THEME, artifactColor } from './theme.ts'

export interface DetailProps {
  readonly rec: ChangeRecord
  readonly ui: ChangesUi
  readonly docs: ChangeDocs
  readonly surface: 'terminal' | 'desktop'
  readonly columns: number
}

export const TABS: readonly ChangesTab[] = CHANGES_TABS

const TAB_TITLES: Readonly<Record<ChangesTab, string>> = {
  summary: 'Summary', diagrams: 'Diagrams', specs: 'Specs', tasks: 'Tasks', verify: 'Verify', history: 'History',
}

function Toolbar(els: Els, io: Io, ctx: Ctx, rec: ChangeRecord): RenderElement {
  const { Box, Button } = els
  const gates = actionsFor(rec)
  const id = rec.id
  return (
    <Box key="toolbar" flexDirection="row" gap={1} flexWrap="wrap">
      <Button key="comment" {...keyed('c', 'comment')} dimColor={!gates.comment.enabled} onPress={act(rec, 'comment', io => composeComment(io, id))} />
      <Button key="draft" {...keyed('d', 'draft next')} dimColor={!gates.draft.enabled} onPress={act(rec, 'draft', io => draftNext(io, ctx, id))} />
      <Button key="explain" {...keyed('e', 'explain')} dimColor={!gates.explain.enabled} onPress={act(rec, 'explain', io => explainChange(io, ctx, id))} />
      <Button key="critique" {...keyed('x', 'critique')} dimColor={!gates.critique.enabled} onPress={act(rec, 'critique', io => critiqueChange(io, ctx, id))} />
      <Button key="run" {...keyed('r', '▶ run')} {...(gates.run.enabled ? { variant: 'primary' as const } : { dimColor: true })} onPress={act(rec, 'run', io => runChange(io, ctx, id))} />
    </Box>
  )
}

/** The change's CLI error as one readable line; `?` (ui.showRaw) adds the raw output below it. */
function ListError(els: Els, rec: ChangeRecord, ui: ChangesUi): RenderElement[] {
  const { Box, Code, Text } = els
  if (rec.listError === undefined) return []
  return [
    <Box key="change-error"><Text color={THEME.brick}>{`⚠ ${readableError(rec.listError)}`}</Text></Box>,
    ...(ui.showRaw ? [<Box key="raw-change-error"><Code source={rec.listError} /></Box>] : []),
  ]
}

function Header(els: Els, rec: ChangeRecord, docs: ChangeDocs, ui: ChangesUi): RenderElement[] {
  const { Box, Text } = els
  const schema = rec.status?.schema ?? ''
  return [
    <Box key="detail-title"><Text bold>{`${rec.id} · ${rec.stage}`}</Text></Box>,
    ...(schema === '' ? [] : [<Box key="detail-schema"><Text dimColor>{`schema · ${schema}`}</Text></Box>]),
    ...ListError(els, rec, ui),
    ...(docs.error === undefined ? [] : [<Box key="docs-error"><Text color={THEME.brick}>{`⚠ ${docs.error}`}</Text></Box>]),
    ...rec.errors.slice(-3).map((error, index) => <Box key={`change-error:${index}`}><Text color={THEME.brick} dimColor>{`⚠ ${error.hook}: ${readableError(error.message)}`}</Text></Box>),
  ]
}

/** One row that wraps between steps: each step keeps its mark and its selectable artifact together. */
function Stepper(els: Els, io: Io, rec: ChangeRecord, ui: ChangesUi): RenderElement[] {
  const { Box, Button, Text } = els
  const target = ui.artifact ?? defaultArtifact(rec)
  const marks = stepperMarks(rec)
  return [
    <Box key="stepper" flexDirection="row" flexWrap="wrap" columnGap={2}>
      {marks.length === 0
        ? <Text dimColor>no CLI status yet</Text>
        : marks.map(step => (
          <Box key={`step:${step.id}`} flexShrink={0} gap={1}>
            <Text color={artifactColor(step.mark)}>{step.mark}</Text>
            <Button key={`artifact:${step.id}`} label={step.id === target ? `[${step.id}]` : step.id} plain onPress={() => void selectArtifact(io, step.id)} />
          </Box>
        ))}
    </Box>,
  ]
}

/** Readiness only gates Run, which needs the plan: until it is written the checks are not shown. */
function Readiness(els: Els, io: Io, ctx: Ctx, rec: ChangeRecord): RenderElement[] {
  const { Box, Button, Text } = els
  if (isPlanPending(rec)) return [<Box key="readiness"><Text dimColor>{READINESS_PENDING}</Text></Box>]
  const isReady = rec.readiness.length > 0 && rec.readiness.every(check => check.ok)
  const color = rec.readiness.length === 0 ? THEME.steel : isReady ? THEME.moss : THEME.brick
  return [
    <Box key="readiness"><Text bold color={color}>{readinessLine(rec)}</Text></Box>,
    ...rec.readiness.filter(check => !check.ok).map(check => <Box key={`check:${check.id}`}><Text color={THEME.brick}>{readinessFailureLine(check)}</Text></Box>),
    ...(offersRepair(rec) ? [<Box key="repair-row"><Button key="repair" {...keyed('k', 'repair tasks')} onPress={act(rec, 'repair', io => repairTasks(io, ctx, rec.id))} /></Box>] : []),
  ]
}

function Tabs(els: Els, io: Io, ui: ChangesUi): RenderElement {
  const { Box, Button } = els
  return (
    <Box key="tabs" flexDirection="row" gap={1}>
      {TABS.map(tab => <Button key={`tab:${tab}`} label={tab === ui.tab ? `▸ ${TAB_TITLES[tab]}` : TAB_TITLES[tab]} plain onPress={() => void setTab(io, tab)} />)}
    </Box>
  )
}

const Docs = (els: Els, files: readonly DocFile[]): RenderElement[] => {
  const { Markdown } = els
  return files.map(file => <Markdown key={`doc:${file.path}`} text={clipMarkdown(file.text)} />)
}

function SummaryTab(els: Els, io: Io, ctx: Ctx, props: DetailProps): RenderElement {
  const { Box, Markdown, Text } = els
  const explanation = props.rec.explanation
  return (
    <Box key="tab-summary" flexDirection="column">
      {explanation === undefined ? null : (
        <Box key="explanation" flexDirection="column">
          <Box key="explanation-state"><Text dimColor>{isExplanationCurrent(props.rec) ? 'explanation · current' : 'explanation · outdated (press e to explain again)'}</Text></Box>
          <Markdown key="explanation-text" text={clipMarkdown([explanation.value.overview, ...explanation.value.sections.map(section => `### ${section.title}\n\n${section.body}`)].join('\n\n'))} />
        </Box>
      )}
      {CritiqueList(els, io, ctx, props.rec)}
      {props.docs.summary.length === 0 ? <Box key="summary-empty"><Text dimColor>No artifact written yet.</Text></Box> : Docs(els, props.docs.summary)}
    </Box>
  )
}

function SpecsTab(els: Els, docs: ChangeDocs): RenderElement {
  const { Box, Text } = els
  return (
    <Box key="tab-specs" flexDirection="column">
      {uncoveredRequirements(docs.specs, docs.parsedTasks).map(name => <Box key={`uncovered:${name}`}><Text bold>{`uncovered: ${name}`}</Text></Box>)}
      {docs.specs.length === 0 ? <Box key="specs-empty"><Text dimColor>No delta spec yet.</Text></Box> : Docs(els, docs.specs)}
    </Box>
  )
}

function TasksTab(els: Els, docs: ChangeDocs): RenderElement {
  const { Box, Text } = els
  return (
    <Box key="tab-tasks" flexDirection="column">
      {docs.tasks === undefined ? <Box key="tasks-empty"><Text dimColor>No tasks.md yet.</Text></Box> : Docs(els, [docs.tasks])}
    </Box>
  )
}

function HistoryTab(els: Els, rec: ChangeRecord): RenderElement {
  const { Box, Text } = els
  const rows = historyRows(rec)
  return (
    <Box key="tab-history" flexDirection="column">
      {rows.length === 0 ? <Box key="history-empty"><Text dimColor>No accepted revision yet.</Text></Box> : rows.map((row, index) => <Box key={`revision:${index}`}><Text>{row}</Text></Box>)}
    </Box>
  )
}

function TabBody(els: Els, io: Io, ctx: Ctx, props: DetailProps): RenderElement {
  switch (props.ui.tab) {
    case 'diagrams':
      return DiagramsTab(els, props)
    case 'specs':
      return SpecsTab(els, props.docs)
    case 'tasks':
      return TasksTab(els, props.docs)
    case 'history':
      return HistoryTab(els, props.rec)
    case 'verify':
      return VerifyTab(els, io, ctx, props.rec)
    default:
      return SummaryTab(els, io, ctx, props)
  }
}

function Overlays(els: Els, io: Io, ctx: Ctx, props: DetailProps): RenderElement[] {
  const { rec, ui } = props
  return [
    ...RetryView(els, io, ctx, rec),
    ...(ui.forecast !== null && ui.forecast.changeId === rec.id ? [ForecastView(els, io, ctx, ui.forecast)] : []),
    ...(rec.proposal === undefined ? [] : [DiffView(els, io, ctx, rec, rec.proposal)]),
    ...(showsQa(rec) ? [QaView(els, io, ctx, rec)] : []),
  ]
}

export function ChangeDetail(els: Els, io: Io, ctx: Ctx, props: DetailProps): RenderElement {
  const { Box } = els
  return (
    <Box key="detail" flexDirection="column" flexGrow={1}>
      {Header(els, props.rec, props.docs, props.ui)}
      {Stepper(els, io, props.rec, props.ui)}
      {Readiness(els, io, ctx, props.rec)}
      {Toolbar(els, io, ctx, props.rec)}
      {Overlays(els, io, ctx, props)}
      {Tabs(els, io, props.ui)}
      {TabBody(els, io, ctx, props)}
    </Box>
  )
}
