import { displayModel } from '../domain/config.ts'
import { activeRun } from '../domain/project.ts'
import type { AgentRun, Board, Phase, Task } from '../domain/types.ts'
import type { View } from '../runtime/ui-types.ts'

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

export function cardLines(task: Task, now: number): string[] {
  const run = activeRun(task)
  const needsHuman = task.status === 'needs_decision' || task.status === 'blocked'
  return [
    stepper(task),
    ...(run === undefined ? [] : [`${heartbeat(run, now)} ${chipText(run, now)}`]),
    ...(task.waitReason === undefined ? [] : [`⏸ ${task.waitReason}`]),
    ...(needsHuman && task.statusReason !== undefined ? [`⚠ ${task.statusReason}`] : []),
  ]
}

export function headerLine(board: Board, view: View): string {
  const label = `[v] ${viewLabel(view)}`
  if (board.changeId === null) return `zboard · no change loaded ${label}`
  const tasks = tasksOf(board)
  const done = tasks.filter(task => task.status === 'done').length
  const agents = tasks.flatMap(task => task.agents).filter(run => run.endedAt === undefined).length
  const decisions = tasks.filter(task => task.status === 'needs_decision').length
  const tokens = tasks.flatMap(task => task.agents).reduce((sum, run) => sum + run.tokens, 0)
  const warnings = [
    ...(board.mirrorPending ? ['⚠ mirror pending'] : []),
    ...(board.configWarnings.length > 0 ? [`⚠ ${plural(board.configWarnings.length, 'config warning')}`] : []),
    ...(board.errors.length > 0 ? [`✖ ${plural(board.errors.length, 'error')}`] : []),
  ]
  return [
    `zboard · ${board.changeId} ${progressBar(done, tasks.length)} ${done}/${tasks.length}`,
    plural(agents, 'agent'),
    decisions === 0 ? '0 decisions' : `⚠ ${plural(decisions, 'decision')}`,
    `${formatTokens(tokens)} tok ${label}`,
    ...warnings,
  ].join(' · ')
}
