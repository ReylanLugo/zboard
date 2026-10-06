import type { RenderElement } from 'claude-code'
import type { Io } from '../runtime/io.ts'

import type { ChangeRecord, PlanBoard } from '../plan/types.ts'
import type { Ctx } from '../runtime/ctx.ts'
import { CHANGES_ID } from '../runtime/ctx.ts'
import type { ChangeDocs } from '../runtime/plan-docs.ts'
import type { ChangesUi, ComposeKind } from '../runtime/ui-types.ts'
import { CHANGES_TABS } from '../runtime/ui-types.ts'
import { ChangeDetail } from './ChangeDetail.tsx'
import { selectChange, setChanges, setTab, startCompose, submitCompose } from './changes-actions.ts'
import { GROUPS, defaultArtifact, groupRows, headerText, rowLabel } from './changes-model.ts'
import type { Els } from './els.ts'

export interface ChangesProps {
  readonly plan: PlanBoard
  readonly ui: ChangesUi
  readonly docs: ChangeDocs
  readonly columns: number
}

type Surface = 'terminal' | 'desktop'

const WIDE = 100
const LIST_WIDTH = 36
const EMPTY_HINT = 'Select a change, or press n to create one.'
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
      {GROUPS.map(group => {
        const rows = groupRows(props.plan, group.id)
        return (
          <Box key={`section:${group.id}`} flexDirection="column">
            <Box key={`group:${group.id}`}><Text bold>{`${group.title} (${rows.length})`}</Text></Box>
            {rows.map(rec => <Button key={`${CHANGE_PREFIX}${rec.id}`} label={rowLabel(rec)} plain onPress={() => void selectChange(io, rec.id)} />)}
          </Box>
        )
      })}
    </Box>
  )
}

function Errors(els: Els, plan: PlanBoard): RenderElement[] {
  const { Box, Text } = els
  return [
    ...(plan.listError === undefined ? [] : [<Box key="list-error"><Text>{`⚠ openspec: ${plan.listError}`}</Text></Box>]),
    ...plan.errors.slice(-3).map((error, index) => <Box key={`error:${index}`}><Text dimColor>{`⚠ ${error.hook}: ${error.message}`}</Text></Box>),
  ]
}

function Detail(els: Els, io: Io, ctx: Ctx, rec: ChangeRecord, props: ChangesProps, surface: Surface): RenderElement {
  return ChangeDetail(els, io, ctx, { rec, ui: props.ui, docs: props.docs, surface, columns: props.columns })
}

function ChangesView(els: Els, surface: Surface, io: Io, ctx: Ctx, props: ChangesProps): RenderElement {
  const { Box, Button, Input, Text } = els
  const rec = props.ui.selected === null ? undefined : props.plan.changes[props.ui.selected]
  const composing = props.ui.composing
  return (
    <Box flexDirection="column">
      <Box key="changes-header"><Text bold>{headerText(props.plan)}</Text></Box>
      {Errors(els, props.plan)}
      <Box key="pane-actions" flexDirection="row" gap={1}>
        <Button key="new" label="new change" hotkey="n" onPress={() => void startCompose(io, 'new')} />
      </Box>
      {composing === null ? null : (
        <Input key="compose" label={composeLabel(composing, rec, props.ui)} placeholder="type, then Enter" autoFocus onSubmit={value => void submitCompose(io, ctx, value)} />
      )}
      <Box key="body" flexDirection={props.columns >= WIDE ? 'row' : 'column'} gap={2}>
        {List(els, io, props)}
        {rec === undefined ? <Box key="changes-empty"><Text dimColor>{EMPTY_HINT}</Text></Box> : Detail(els, io, ctx, rec, props, surface)}
      </Box>
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

export const closeChanges = (io: Io): Promise<void> => setChanges(io, ui => ({ ...ui, composing: null, forecast: null }))
