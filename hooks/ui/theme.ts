import type { Role, TaskStatus } from '../domain/types.ts'
import type { ChangeStage } from '../plan/types.ts'

/**
 * The "blueprint" theme: cyan ink lines, construction-signal colors for state,
 * restraint everywhere else. The single source of every color zboard draws.
 *
 * Raw `#RRGGBB` values: the terminal (Ink) and the desktop both take a raw
 * color for Text `color` and Box `borderColor`, so no per-surface mapping is
 * needed. No global background is set, so the board reads on dark and light
 * terminals alike.
 */
export const THEME = {
  /** Identity accent: selection, active borders, the header ruler. */
  blueprint: '#4FA3C7',
  /** Idle borders, secondary text, blocked. */
  steel: '#7A8594',
  /** In progress, running. */
  signal: '#E0A43A',
  /** Done, green tests, diff `+`. */
  moss: '#6FA36B',
  /** Needs a decision, errors, diff `-`. */
  brick: '#C8553D',
  /** Main text on a filled selection; reserved, no fill is drawn today. */
  chalk: '#C9CED6',
} as const

export type Color = `#${string}`

/** `{ color }` for a Text when there is one, `{}` for the default ink. */
export const ink = (color: Color | undefined): { readonly color?: Color } => (color === undefined ? {} : { color })

const STATUS_COLOR: Readonly<Record<TaskStatus, Color | undefined>> = {
  backlog: undefined,
  ready: undefined,
  running: THEME.signal,
  review: THEME.signal,
  needs_decision: THEME.brick,
  blocked: THEME.steel,
  done: THEME.moss,
}

/** A task status's color; ready and backlog keep the terminal's default ink. */
export const statusColor = (status: TaskStatus): Color | undefined => STATUS_COLOR[status]

const STAGE_COLOR: Readonly<Record<ChangeStage, Color>> = {
  draft: THEME.steel,
  authoring: THEME.signal,
  ready: THEME.blueprint,
  executing: THEME.signal,
  verifying: THEME.blueprint,
  retrospective: THEME.blueprint,
  archiving: THEME.blueprint,
  archived: THEME.moss,
}

export const stageColor = (stage: ChangeStage): Color => STAGE_COLOR[stage]

const channels = (hex: string): number[] => [1, 3, 5].map(at => Number.parseInt(hex.slice(at, at + 2), 16))

/** The midpoint of two tokens: quiet, distinct role colors derived from the palette. */
export function mix(a: Color, b: Color): Color {
  const [left, right] = [channels(a), channels(b)]
  const mid = left.map((value, index) => Math.round((value + (right[index] ?? value)) / 2))
  return `#${mid.map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

const ROLE_COLOR: Readonly<Record<Role, Color>> = {
  researcher: THEME.blueprint,
  planner: mix(THEME.blueprint, THEME.chalk),
  tdd: mix(THEME.moss, THEME.chalk),
  implementer: mix(THEME.blueprint, THEME.moss),
  reviewer: mix(THEME.blueprint, THEME.brick),
  refactorer: mix(THEME.steel, THEME.signal),
}

export const roleColor = (role: Role): Color => ROLE_COLOR[role]

const HEARTBEAT_COLOR: Readonly<Record<'🟢' | '🟠' | '🔴', Color>> = { '🟢': THEME.moss, '🟠': THEME.signal, '🔴': THEME.brick }

/** An agent's heartbeat: moss when active, signal when idle over five minutes, brick on error. */
export const heartbeatColor = (beat: '🟢' | '🟠' | '🔴'): Color => HEARTBEAT_COLOR[beat]

const ARTIFACT_COLOR: Readonly<Record<'●' | '◐' | '○', Color>> = { '●': THEME.moss, '◐': THEME.blueprint, '○': THEME.steel }

/** An artifact step: done moss, current blueprint, not reached steel. */
export const artifactColor = (mark: '●' | '◐' | '○'): Color => ARTIFACT_COLOR[mark]

/** A unified-diff line: `+` moss, `-` brick, hunk headers blueprint, file headers steel, context default. */
export function diffLineColor(line: string): Color | undefined {
  if (line.startsWith('+++') || line.startsWith('---')) return THEME.steel
  if (line.startsWith('@@')) return THEME.blueprint
  if (line.startsWith('+')) return THEME.moss
  if (line.startsWith('-')) return THEME.brick
  return undefined
}
