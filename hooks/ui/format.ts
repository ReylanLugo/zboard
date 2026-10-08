import { displayModel } from '../domain/config.ts'
import { activeRun } from '../domain/project.ts'
import type { AgentRun, Board, Phase, Task } from '../domain/types.ts'
import type { View } from '../runtime/ui-types.ts'
import type { Color } from './theme.ts'
import { THEME, roleColor } from './theme.ts'

export const PROGRESS_CELLS = 5
export const IDLE_MS = 5 * 60_000
const THOUSAND = 1_000
const MILLION = 1_000_000

const VIEW_LABEL: Readonly<Record<View, string>> = { kanban: 'Kanban', swimlane: 'Swimlanes', tree: 'Tree' }
const STEPS: readonly (readonly [Phase, string])[] = [['research', 'R'], ['plan', 'P'], ['tdd', 'T'], ['code', 'C'], ['review', 'Rv']]
const RED_OUTCOMES = new Set(['error', 'interrupted', 'denied'])

export const viewLabel = (view: View): string => VIEW_LABEL[view]
const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

const tasksOf = (board: Board): Task[] =>
  board.order.map(id => board.tasks[id]).filter((task): task is Task => task !== undefined)

export function progressBar(done: number, total: number): string {
  const filled = total === 0 ? 0 : Math.round((done / total) * PROGRESS_CELLS)
  return `${'▓'.repeat(filled)}${'░'.repeat(PROGRESS_CELLS - filled)}`
}

export function formatTokens(tokens: number): string {
  if (tokens >= MILLION) return `${(tokens / MILLION).toFixed(1)}M`
  if (tokens >= THOUSAND) return `${Math.round(tokens / THOUSAND)}k`
  return String(tokens)
}

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1_000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`
}

function markOf(task: Task, phase: Phase, current: Phase | null): string {
  if (phase === current) return '●'
  const last = [...task.phases].reverse().find(record => record.phase === phase)
  if (last === undefined) return '○'
  return last.gate === 'pass' ? '✓' : '✗'
}

export function stepper(task: Task): string {
  const isActive = task.status === 'running' || task.status === 'review'
  const current = isActive ? (task.pending?.phase ?? task.phase) : null
  return [
    ...STEPS.map(([phase, letter]) => `${letter}${markOf(task, phase, current)}`),
    ...(current === 'refactor' ? ['Rf●'] : []),
    ...(task.loop > 0 ? [`↺${task.loop}`] : []),
  ].join(' ')
}

export function heartbeat(run: AgentRun, now: number): '🟢' | '🟠' | '🔴' {
  if (run.outcome !== undefined && RED_OUTCOMES.has(run.outcome)) return '🔴'
  return now - run.lastActivityAt > IDLE_MS ? '🟠' : '🟢'
}

export const chipText = (run: AgentRun, now: number): string =>
  `${run.agentType} ${displayModel(run.model)}/${run.effort ?? 'n/a'} · ${run.currentTool ?? 'idle'} · ${formatElapsed((run.endedAt ?? now) - run.startedAt)} · ${formatTokens(run.tokens)} tok`

/** One line of a card, with the color it is drawn in. */
export interface CardRow {
  readonly text: string
  readonly color?: Color
  readonly dim?: boolean
}

export function cardRows(task: Task, now: number): CardRow[] {
  const run = activeRun(task)
  const needsHuman = task.status === 'needs_decision' || task.status === 'blocked'
  return [
    { text: stepper(task), dim: true },
    ...(run === undefined ? [] : [{ text: `${heartbeat(run, now)} ${chipText(run, now)}`, color: roleColor(run.role) }]),
    ...(task.waitReason === undefined ? [] : [{ text: `⏸ ${task.waitReason}`, color: THEME.signal }]),
    ...(needsHuman && task.statusReason !== undefined ? [{ text: `⚠ ${task.statusReason}`, color: THEME.brick }] : []),
  ]
}

export const cardLines = (task: Task, now: number): string[] => cardRows(task, now).map(row => row.text)

interface HeaderFacts {
  readonly done: number
  readonly total: number
  readonly agents: number
  readonly decisions: number
  readonly tokens: number
}

function factsOf(board: Board): HeaderFacts {
  const tasks = tasksOf(board)
  const runs = tasks.flatMap(task => task.agents)
  return {
    done: tasks.filter(task => task.status === 'done').length,
    total: tasks.length,
    agents: runs.filter(run => run.endedAt === undefined).length,
    decisions: tasks.filter(task => task.status === 'needs_decision').length,
    tokens: runs.reduce((sum, run) => sum + run.tokens, 0),
  }
}

/** One colored piece of a header line. */
export interface HeaderSegment {
  readonly text: string
  readonly color?: Color
}

const warningSegments = (board: Board): HeaderSegment[] => [
  ...(board.mirrorPending ? [{ text: '⚠ mirror pending', color: THEME.signal }] : []),
  ...(board.configWarnings.length > 0 ? [{ text: `⚠ ${plural(board.configWarnings.length, 'config warning')}`, color: THEME.signal }] : []),
  ...(board.errors.length > 0 ? [{ text: `✖ ${plural(board.errors.length, 'error')}`, color: THEME.brick }] : []),
]

export function headerLine(board: Board, view: View): string {
  const label = `[v] ${viewLabel(view)}`
  if (board.changeId === null) return `zboard · no change loaded ${label}`
  const facts = factsOf(board)
  return [
    `zboard · ${board.changeId} ${progressBar(facts.done, facts.total)} ${facts.done}/${facts.total}`,
    plural(facts.agents, 'agent'),
    facts.decisions === 0 ? '0 decisions' : `⚠ ${plural(facts.decisions, 'decision')}`,
    `${formatTokens(facts.tokens)} tok ${label}`,
    ...warningSegments(board).map(segment => segment.text),
  ].join(' · ')
}

/** The header as a dimension ruler, then its facts; the facts wrap below the ruler when the width is short. */
export interface HeaderRuler {
  readonly ruler: readonly HeaderSegment[]
  readonly facts: readonly HeaderSegment[]
}

const RULER_MIN_FILL = 3
const RULER_SAFETY = 1
const FACTS_GAP = '  '
const SEP: HeaderSegment = { text: ' · ' }
const textLength = (segments: readonly HeaderSegment[]): number => segments.reduce((sum, segment) => sum + segment.text.length, 0)
const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`)
const hasText = (segment: HeaderSegment): boolean => segment.text !== ''

function factSegments(board: Board, view: View, facts: HeaderFacts | null): HeaderSegment[] {
  const counts: HeaderSegment[] = facts === null ? [] : [
    { text: `◐ ${facts.agents} running`, ...(facts.agents > 0 ? { color: THEME.signal } : {}) },
    SEP,
    facts.decisions === 0 ? { text: '0 decisions' } : { text: `⚠ ${plural(facts.decisions, 'decision')}`, color: THEME.brick },
    SEP,
    { text: `${formatTokens(facts.tokens)} tok` },
    SEP,
  ]
  return [{ text: FACTS_GAP }, ...counts, { text: `[v] ${viewLabel(view)}` }, ...warningSegments(board).flatMap(segment => [SEP, segment])]
}

/** The ruler around `label`, `fill` dashes long, with the progress at its right end when there is a change. */
function rulerSegments(label: string, fill: number, facts: HeaderFacts | null): HeaderSegment[] {
  const dashes = '─'.repeat(Math.max(RULER_MIN_FILL, fill))
  if (facts === null) return [{ text: '├─ ', color: THEME.blueprint }, { text: label }, { text: ` ${dashes}┤`, color: THEME.blueprint }]
  const filled = progressBar(facts.done, facts.total).replace(/░/g, '')
  return [
    { text: '├─ ', color: THEME.blueprint },
    { text: label },
    { text: ` ${dashes} `, color: THEME.blueprint },
    { text: `${facts.done}/${facts.total} ` },
    { text: filled, color: THEME.moss },
    { text: '░'.repeat(PROGRESS_CELLS - filled.length), color: THEME.steel },
    { text: ' ─┤', color: THEME.blueprint },
  ].filter(hasText)
}

/** Fits the ruler to `columns`: beside the facts when both fit, the whole width otherwise, clipping a long change id. */
export function headerRuler(board: Board, view: View, columns: number): HeaderRuler {
  const facts = board.changeId === null ? null : factsOf(board)
  const label = `zboard · ${board.changeId ?? 'no change loaded'}`
  const factLine = factSegments(board, view, facts)
  const fixed = textLength(rulerSegments(label, 0, facts)) - RULER_MIN_FILL
  const room = Math.max(0, columns - RULER_SAFETY)
  const beside = room - textLength(factLine)
  const width = fixed + RULER_MIN_FILL <= beside ? beside : room
  const fitted = clip(label, label.length - Math.max(0, fixed + RULER_MIN_FILL - width))
  return { ruler: rulerSegments(fitted, width - (fixed - label.length + fitted.length), facts), facts: factLine }
}
