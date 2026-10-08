import type { RenderElement } from 'claude-code'
import type { Io } from '../runtime/io.ts'

import type { ChangeRecord, PlanBoard } from '../plan/types.ts'
import type { Ctx } from '../runtime/ctx.ts'
import { CHANGES_ID } from '../runtime/ctx.ts'
import type { ChangeDocs } from '../runtime/plan-docs.ts'
import type { ChangesUi, ComposeKind } from '../runtime/ui-types.ts'
import { CHANGES_TABS } from '../runtime/ui-types.ts'
import { ChangeDetail } from './ChangeDetail.tsx'
import { readableError } from '../plan/errors.ts'
import { initOpenspec } from '../runtime/plan-init.ts'
import { isolatePlan } from '../runtime/plan-store.ts'
import { selectChange, setChanges, setTab, startCompose, submitCompose, toggleRaw } from './changes-actions.ts'
import { GROUPS, STAGE_ICONS, defaultArtifact, groupRows, groupTitle, headerText, isNotInitialized, listIssue, rowText, visibleChanges } from './changes-model.ts'
import type { Els } from './els.ts'
import { THEME, stageColor } from './theme.ts'

export interface ChangesProps {
  readonly plan: PlanBoard
  readonly ui: ChangesUi
  readonly docs: ChangeDocs
  readonly columns: number
  /** The repository root, named on the init card. */
  readonly root: string
}

type Surface = 'terminal' | 'desktop'

const WIDE = 100
const LIST_WIDTH = 36
const EMPTY_HINT = 'Select a change, or press n to create one.'
const NONE_HINT = 'No changes yet. A change holds a proposal, specs and tasks; press n to start one.'
const INIT_TITLE = '◇  This folder has no OpenSpec project yet'
const INIT_WHY = [
  'OpenSpec keeps each plan as a proposal, design, specs and tasks',
  'in an ./openspec folder at the root of this repository.',
] as const
const CHANGE_PREFIX = 'change:'
const TAB_PREFIX = 'tab:'

function composeLabel(kind: ComposeKind, rec: ChangeRecord | undefined, ui: ChangesUi): string {
  if (kind === 'new') return 'new change id (kebab-case)'
  if (kind === 'note') return 'note for another version'
  return `comment on ${ui.artifact ?? (rec === undefined ? 'the change' : defaultArtifact(rec))}`
}

function List(els: Els, io: Io, props: ChangesProps): RenderElement {
  const { Box, Button, Text } = els
  return (
    <Box key="list" flexDirection="column" width={props.columns >= WIDE ? LIST_WIDTH : '100%'}>
      {GROUPS.map(group => (
        <Box key={`section:${group.id}`} flexDirection="column">
          <Box key={`group:${group.id}`}><Text bold>{groupTitle(props.plan, group)}</Text></Box>
          {groupRows(props.plan, group.id).map(rec => (
            <Box key={`row:${rec.id}`} flexDirection="row" gap={1}>
              <Box key={`icon:${rec.id}`}><Text color={stageColor(rec.stage)}>{STAGE_ICONS[rec.stage]}</Text></Box>
              <Button key={`${CHANGE_PREFIX}${rec.id}`} label={rowText(rec)} plain onPress={() => void selectChange(io, rec.id)} />
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  )
}

/** One readable line per error; `?` adds the raw output of the list error below it. */
function Errors(els: Els, plan: PlanBoard, ui: ChangesUi): RenderElement[] {
  const { Box, Code, Text } = els
  const issue = listIssue(plan)
  return [
    ...(issue === undefined ? [] : [<Box key="list-error"><Text color={THEME.brick}>{`⚠ ${readableError(issue)}`}</Text></Box>]),
    ...(issue === undefined || !ui.showRaw ? [] : [<Box key="raw-list-error"><Code source={issue} /></Box>]),
    ...plan.errors.slice(-3).map((error, index) => <Box key={`error:${index}`}><Text color={THEME.brick} dimColor>{`⚠ ${error.hook}: ${readableError(error.message)}`}</Text></Box>),
  ]
}

/** Whether any shown error has raw output behind it, so `?` has something to toggle. */
function hasRaw(plan: PlanBoard, ui: ChangesUi, rec: ChangeRecord | undefined): boolean {
  if (isNotInitialized(plan)) return (ui.initError ?? null) !== null
  return listIssue(plan) !== undefined || rec?.listError !== undefined
}

function RawToggle(els: Els, io: Io, ui: ChangesUi): RenderElement {
  const { Button } = els
  return <Button key="raw" label={ui.showRaw ? 'hide raw output' : 'raw output'} hotkey="o" plain onPress={() => void toggleRaw(io)} />
}

function InitCard(els: Els, io: Io, props: ChangesProps): RenderElement {
  const { Box, Button, Code, Text } = els
  const failed = props.ui.initError ?? null
  return (
    <Box key="init-card" flexDirection="column" gap={1} borderStyle="round" borderColor={THEME.blueprint} paddingX={1}>
      <Box key="init-title"><Text bold>{INIT_TITLE}</Text></Box>
      <Box key="init-why" flexDirection="column">
        {INIT_WHY.map((line, index) => <Box key={`init-why-${index + 1}`}><Text dimColor>{line}</Text></Box>)}
      </Box>
      <Box key="init-actions" flexDirection="row" gap={1}>
        <Button key="init" label="Initialize OpenSpec here" hotkey="i" variant="primary" onPress={() => void isolatePlan(io, 'ui.init', () => initOpenspec(io), undefined)} />
        {failed === null ? null : RawToggle(els, io, props.ui)}
      </Box>
      {failed === null ? null : <Box key="init-error"><Text color={THEME.brick}>{`⚠ OpenSpec init failed: ${readableError(failed)}`}</Text></Box>}
      {failed === null || !props.ui.showRaw ? null : <Box key="raw-init-error"><Code source={failed} /></Box>}
      <Box key="init-root"><Text dimColor>{props.root}</Text></Box>
    </Box>
  )
}

function NoChanges(els: Els, io: Io): RenderElement {
  const { Box, Button, Text } = els
  return (
    <Box key="changes-none" flexDirection="column" gap={1}>
      <Box key="none-actions"><Button key="new" label="n  New change" hotkey="n" onPress={() => void startCompose(io, 'new')} /></Box>
      <Box key="changes-none-hint"><Text dimColor>{NONE_HINT}</Text></Box>
    </Box>
  )
}

function Detail(els: Els, io: Io, ctx: Ctx, rec: ChangeRecord, props: ChangesProps, surface: Surface): RenderElement {
  return ChangeDetail(els, io, ctx, { rec, ui: props.ui, docs: props.docs, surface, columns: props.columns })
}

function Body(els: Els, surface: Surface, io: Io, ctx: Ctx, props: ChangesProps): RenderElement {
  const { Box, Text } = els
  const rec = props.ui.selected === null ? undefined : props.plan.changes[props.ui.selected]
  if (visibleChanges(props.plan).length === 0 && listIssue(props.plan) === undefined) return NoChanges(els, io)
  return (
    <Box key="body" flexDirection={props.columns >= WIDE ? 'row' : 'column'} gap={2}>
      {List(els, io, props)}
      {rec === undefined ? <Box key="changes-empty"><Text dimColor>{EMPTY_HINT}</Text></Box> : Detail(els, io, ctx, rec, props, surface)}
    </Box>
  )
}

function Actions(els: Els, io: Io, props: ChangesProps, rec: ChangeRecord | undefined): RenderElement | null {
  const { Box, Button } = els
  const isEmpty = visibleChanges(props.plan).length === 0 && listIssue(props.plan) === undefined
  const raw = hasRaw(props.plan, props.ui, rec)
  if (isEmpty && !raw) return null
  return (
    <Box key="pane-actions" flexDirection="row" gap={1}>
      {isEmpty ? null : <Button key="new" label="new change" hotkey="n" onPress={() => void startCompose(io, 'new')} />}
      {raw ? RawToggle(els, io, props.ui) : null}
    </Box>
  )
}

function ChangesView(els: Els, surface: Surface, io: Io, ctx: Ctx, props: ChangesProps): RenderElement {
  const { Box, Input, Text } = els
  const rec = props.ui.selected === null ? undefined : props.plan.changes[props.ui.selected]
  const composing = props.ui.composing
  const header = <Box key="changes-header"><Text bold color={THEME.blueprint}>{headerText(props.plan)}</Text></Box>
  if (isNotInitialized(props.plan)) return <Box flexDirection="column">{header}{Errors(els, props.plan, props.ui)}{InitCard(els, io, props)}</Box>
  return (
    <Box flexDirection="column">
      {header}
      {Errors(els, props.plan, props.ui)}
      {Actions(els, io, props, rec)}
      {composing === null ? null : (
        <Input key="compose" label={composeLabel(composing, rec, props.ui)} placeholder="type, then Enter" autoFocus onSubmit={value => void submitCompose(io, ctx, value)} />
      )}
      {Body(els, surface, io, ctx, props)}
    </Box>
  )
}

/** Draws the changes viewer. Its `ui.render` hook (register.tsx) reads the atoms and the docs; every write happens in a handler. */
export function renderChanges(els: unknown, surface: string, io: Io, ctx: Ctx, props: ChangesProps): RenderElement {
  if (surface !== 'terminal' && surface !== 'desktop') {
    const { Text } = els as Els
    return <Text>{headerText(props.plan)}</Text>
  }
  return ChangesView(els as Els, surface, io, ctx, props)
}

/** The single ui.focus hook dispatches here for the viewer: Tab onto a change or a tab selects it. */
export async function focusChange(io: Io, requestId: string, element: string | undefined): Promise<void> {
  if (requestId !== CHANGES_ID || element === undefined) return
  if (element.startsWith(CHANGE_PREFIX)) {
    await selectChange(io, element.slice(CHANGE_PREFIX.length))
    return
  }
  const tab = CHANGES_TABS.find(candidate => `${TAB_PREFIX}${candidate}` === element)
  if (tab !== undefined) await setTab(io, tab)
}

export const closeChanges = (io: Io): Promise<void> => setChanges(io, ui => ({ ...ui, composing: null, forecast: null, showRaw: false, initError: null }))
