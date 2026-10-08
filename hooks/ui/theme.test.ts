import { expect, test } from 'claude-code/testing'

import type { TaskStatus } from '../domain/types.ts'
import { ROLES } from '../domain/types.ts'
import type { ChangeStage } from '../plan/types.ts'
import { STAGE_ICONS } from './changes-model.ts'
import { artifactColor, diffLineColor, heartbeatColor, ink, roleColor, stageColor, statusColor, THEME } from './theme.ts'

const HEX = /^#[0-9A-F]{6}$/
const STATUSES: readonly TaskStatus[] = ['backlog', 'ready', 'running', 'review', 'needs_decision', 'blocked', 'done']
const tokens = Object.values(THEME)

test('every theme token is a #RRGGBB raw color, which both surfaces accept', () => {
  expect(Object.keys(THEME).sort()).toEqual(['blueprint', 'brick', 'chalk', 'moss', 'signal', 'steel'])
  for (const color of tokens) expect(color).toMatch(HEX)
})

test('statusColor maps each status to its construction signal; ready and backlog keep the default ink', () => {
  const mapped = Object.fromEntries(STATUSES.map(status => [status, statusColor(status)]))
  expect(mapped).toEqual({
    backlog: undefined, ready: undefined,
    running: THEME.signal, review: THEME.signal,
    needs_decision: THEME.brick, blocked: THEME.steel, done: THEME.moss,
  })
})

test('stageColor gives every change stage a theme token', () => {
  for (const stage of Object.keys(STAGE_ICONS) as ChangeStage[]) expect(tokens).toContain(stageColor(stage))
  expect(stageColor('archived')).toBe(THEME.moss)
  expect(stageColor('draft')).toBe(THEME.steel)
  expect(stageColor('executing')).toBe(THEME.signal)
})

test('roleColor gives every agent role a distinct hex color derived from the tokens', () => {
  const colors = ROLES.map(roleColor)
  for (const color of colors) expect(color).toMatch(HEX)
  expect(new Set(colors).size).toBe(ROLES.length)
  expect(roleColor('researcher')).toBe(THEME.blueprint)
})

test('heartbeat, artifact step and diff line colors follow the tokens', () => {
  expect([heartbeatColor('🟢'), heartbeatColor('🟠'), heartbeatColor('🔴')]).toEqual([THEME.moss, THEME.signal, THEME.brick])
  expect([artifactColor('●'), artifactColor('◐'), artifactColor('○')]).toEqual([THEME.moss, THEME.blueprint, THEME.steel])
  expect(diffLineColor('+added')).toBe(THEME.moss)
  expect(diffLineColor('-removed')).toBe(THEME.brick)
  expect(diffLineColor('@@ -1,2 +1,2 @@')).toBe(THEME.blueprint)
  expect(diffLineColor('+++ b/design.md')).toBe(THEME.steel)
  expect(diffLineColor('--- a/design.md')).toBe(THEME.steel)
  expect(diffLineColor(' context')).toBeUndefined()
})

test('ink spreads a color prop only when there is one', () => {
  expect(ink(THEME.moss)).toEqual({ color: THEME.moss })
  expect(ink(undefined)).toEqual({})
})
