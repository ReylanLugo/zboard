import { expect, test } from 'claude-code/testing'

import type { EventBody } from '../domain/events.ts'
import { project } from '../domain/project.ts'
import { evs, loaded, parsed } from '../testing/factories.ts'
import { filterLabel, nextFilter, visibleTasks } from './filter.ts'
import { cardLines, cardRows, formatElapsed, formatTokens, headerLine, headerRuler, heartbeat, progressBar, stepper } from './format.ts'
import { THEME, roleColor } from './theme.ts'

const started = (taskId: string, agentId: string, phase: 'code' | 'review' | 'refactor' = 'code'): EventBody => ({
  type: 'PhaseStarted', taskId, phase, attempt: 1, agentId,
  agentType: phase === 'review' ? 'zboard:reviewer' : 'zboard:implementer', role: phase === 'review' ? 'reviewer' : 'implementer',
  model: 'claude-sonnet-5-5', effort: 'medium', baseline: {},
})
const passed = (taskId: string, phase: 'research' | 'plan' | 'tdd' | 'code' | 'review'): EventBody => ({ type: 'PhaseCompleted', taskId, phase, attempt: 1, gate: 'pass' })

test('the header reads exactly as the spec shows', () => {
  const labels = Array.from({ length: 12 }, (_, index) => parsed(`1.${index + 1}`, { done: index < 7 }))
  const board = project(evs([
    { type: 'ChangeLoaded', tasks: labels },
    started('1.8', 'a1'), started('1.9', 'a2'), started('1.10', 'a3'),
    { type: 'AgentActivity', agentId: 'a1', tokens: 100_000 },
    { type: 'AgentActivity', agentId: 'a2', tokens: 82_000 },
    { type: 'TaskStatusChanged', taskId: '1.11', from: 'running', to: 'needs_decision', reason: 'plan too narrow' },
  ]).map(event => ({ ...event, changeId: 'zboard-v1' })))
  expect(headerLine(board, 'kanban')).toBe('zboard · zboard-v1 ▓▓▓░░ 7/12 · 3 agents · ⚠ 1 decision · 182k tok [v] Kanban')
})

const specBoard = () => project(evs([
  { type: 'ChangeLoaded', tasks: Array.from({ length: 12 }, (_, index) => parsed(`1.${index + 1}`, { done: index < 7 })) },
  started('1.8', 'a1'), started('1.9', 'a2'), started('1.10', 'a3'),
  { type: 'AgentActivity', agentId: 'a1', tokens: 100_000 },
  { type: 'AgentActivity', agentId: 'a2', tokens: 82_000 },
  { type: 'TaskStatusChanged', taskId: '1.11', from: 'running', to: 'needs_decision', reason: 'plan too narrow' },
]).map(event => ({ ...event, changeId: 'zboard-v1' })))
type Ruler = ReturnType<typeof headerRuler>
const flat = (header: Ruler) => [...header.ruler, ...header.facts]
const joined = (header: Ruler): string => flat(header).map(segment => segment.text).join('')
const rulerOf = (line: string): string => line.slice(0, line.indexOf('┤') + 1)

test('the header ruler holds the change, progress and every count, and fits the width', () => {
  const header = headerRuler(specBoard(), 'kanban', 120)
  const line = joined(header)
  const segments = flat(header)
  expect(line).toMatch(/^├─ zboard · zboard-v1 ─+ 7\/12 ▓▓▓░░ ─┤  ◐ 3 running · ⚠ 1 decision · 182k tok · \[v\] Kanban$/)
  expect(line.length).toBeLessThanOrEqual(120)
  expect(line.length).toBeGreaterThan(110)
  const colorOf = (text: string) => segments.find(segment => segment.text === text)?.color
  expect(colorOf('├─ ')).toBe(THEME.blueprint)
  expect(colorOf('▓▓▓')).toBe(THEME.moss)
  expect(colorOf('░░')).toBe(THEME.steel)
  expect(colorOf('◐ 3 running')).toBe(THEME.signal)
  expect(colorOf('⚠ 1 decision')).toBe(THEME.brick)
})

test('a narrow header keeps the ruler within the width and the facts after it; a long change id is clipped', () => {
  const narrow = joined(headerRuler(specBoard(), 'tree', 60))
  expect(rulerOf(narrow).length).toBeLessThanOrEqual(60)
  expect(narrow).toContain('7/12 ▓▓▓░░')
  expect(narrow).toMatch(/◐ 3 running · ⚠ 1 decision · 182k tok · \[v\] Tree$/)
  const long = project(evs([loaded(parsed('1.1'))]).map(event => ({ ...event, changeId: 'a-very-long-change-identifier-that-does-not-fit' })))
  const clipped = rulerOf(joined(headerRuler(long, 'kanban', 40)))
  expect(clipped.length).toBeLessThanOrEqual(40)
  expect(clipped).toMatch(/^├─ zboard · a-very.*… ─+ 0\/1 ░░░░░ ─┤$/)
})

test('the header ruler keeps the warnings and the no-change state', () => {
  const board = project(evs([
    loaded(parsed('1.1')),
    { type: 'MirrorState', pending: true },
    { type: 'ConfigWarnings', warnings: ['a', 'b'] },
    { type: 'ModError', hook: 'h', message: 'm' },
  ]))
  const header = headerRuler(board, 'swimlane', 160)
  const segments = flat(header)
  expect(joined(header)).toMatch(/◐ 0 running · 0 decisions · 0 tok · \[v\] Swimlanes · ⚠ mirror pending · ⚠ 2 config warnings · ✖ 1 error$/)
  expect(segments.find(segment => segment.text === '✖ 1 error')?.color).toBe(THEME.brick)
  expect(joined(headerRuler(project([]), 'tree', 80))).toMatch(/^├─ zboard · no change loaded ─+┤  \[v\] Tree$/)
})

test('the header appends mirror, configuration and error warnings', () => {
  const board = project(evs([
    loaded(parsed('1.1')),
    { type: 'MirrorState', pending: true },
    { type: 'ConfigWarnings', warnings: ['a', 'b'] },
    { type: 'ModError', hook: 'h', message: 'm' },
  ]))
  expect(headerLine(board, 'swimlane')).toBe('zboard · demo ░░░░░ 0/1 · 0 agents · 0 decisions · 0 tok [v] Swimlanes · ⚠ mirror pending · ⚠ 2 config warnings · ✖ 1 error')
  expect(headerLine(project([]), 'tree')).toBe('zboard · no change loaded [v] Tree')
})

test('numbers format compactly', () => {
  expect(progressBar(0, 0)).toBe('░░░░░')
  expect(formatTokens(950)).toBe('950')
  expect(formatTokens(182_000)).toBe('182k')
  expect(formatTokens(1_250_000)).toBe('1.3M')
  expect(formatElapsed(45_000)).toBe('45s')
  expect(formatElapsed(192_000)).toBe('3m12s')
  expect(formatElapsed(3_900_000)).toBe('1h05m')
})

test('a task in review on loop 1 shows the stepper and its agent chip', () => {
  const board = project(evs([
    loaded(parsed('1.1')),
    passed('1.1', 'research'), passed('1.1', 'plan'), passed('1.1', 'tdd'), passed('1.1', 'code'), passed('1.1', 'review'),
    started('1.1', 'r1', 'refactor'),
    { type: 'AgentStopped', agentId: 'r1' },
    started('1.1', 'v2', 'review'),
    { type: 'AgentActivity', agentId: 'v2', tool: 'Read', tokens: 12_000 },
  ]))
  const task = board.tasks['1.1']
  if (task === undefined) throw new Error('missing task')
  expect(stepper(task)).toBe('R✓ P✓ T✓ C✓ Rv● ↺1')
  expect(cardLines(task, 1_008 + 192_000)).toEqual([
    'R✓ P✓ T✓ C✓ Rv● ↺1',
    '🟢 zboard:reviewer sonnet 5.5/medium · Read · 3m12s · 12k tok',
  ])
})

test('card rows carry their colors: dim stepper, role-colored chip, signal wait, brick decision', () => {
  const board = project(evs([
    loaded(parsed('1.1'), parsed('1.2')),
    started('1.1', 'r1', 'review'),
    { type: 'TaskUpdated', taskId: '1.1', patch: { waitReason: 'waits 1.2 for auth.ts' } },
    { type: 'TaskStatusChanged', taskId: '1.2', from: 'running', to: 'needs_decision', reason: 'plan too narrow' },
  ]))
  const reviewing = board.tasks['1.1']
  const deciding = board.tasks['1.2']
  if (reviewing === undefined || deciding === undefined) throw new Error('missing task')
  const rows = cardRows(reviewing, 0)
  expect(rows.map(row => row.text)).toEqual(cardLines(reviewing, 0))
  expect(rows[0]?.dim).toBe(true)
  expect(rows.find(row => row.text.includes('zboard:reviewer'))?.color).toBe(roleColor('reviewer'))
  expect(rows.find(row => row.text.startsWith('⏸'))?.color).toBe(THEME.signal)
  expect(cardRows(deciding, 0).find(row => row.text.startsWith('⚠'))?.color).toBe(THEME.brick)
})

test('heartbeat is green while active, amber after 5 idle minutes, red on error', () => {
  const run = { agentId: 'a', agentType: 'zboard:tdd', role: 'tdd' as const, phase: 'tdd' as const, attempt: 1, taskId: '1.1', model: 'm', startedAt: 0, lastActivityAt: 0, tokens: 0, denies: 0, baseline: {} }
  expect(heartbeat(run, 60_000)).toBe('🟢')
  expect(heartbeat(run, 300_001)).toBe('🟠')
  expect(heartbeat({ ...run, outcome: 'error' }, 1)).toBe('🔴')
})

test('cards show wait reasons and decision reasons', () => {
  const board = project(evs([
    loaded(parsed('1.1'), parsed('1.2')),
    { type: 'TaskUpdated', taskId: '1.1', patch: { waitReason: 'waits 1.2 for auth.ts' } },
    { type: 'TaskStatusChanged', taskId: '1.2', from: 'running', to: 'needs_decision', reason: 'plan too narrow' },
  ]))
  const at = (id: string) => {
    const task = board.tasks[id]
    if (task === undefined) throw new Error(`missing task ${id}`)
    return task
  }
  expect(cardLines(at('1.1'), 0)).toContain('⏸ waits 1.2 for auth.ts')
  expect(cardLines(at('1.2'), 0)).toContain('⚠ plan too narrow')
})

test('filters cycle through statuses, agents and sections and select matching tasks', () => {
  const board = project(evs([
    loaded(parsed('1.1'), parsed('2.1', { section: '2. Later' })),
    { type: 'TaskStatusChanged', taskId: '1.1', from: 'running', to: 'needs_decision' },
  ]))
  let filter = nextFilter(board, { kind: 'none' })
  expect(filterLabel(filter)).toBe('status: backlog')
  while (!(filter.kind === 'status' && filter.value === 'needs_decision')) filter = nextFilter(board, filter)
  expect(visibleTasks(board, filter).map(task => task.id)).toEqual(['1.1'])
  expect(visibleTasks(board, { kind: 'section', value: '2. Later' }).map(task => task.id)).toEqual(['2.1'])
  expect(filterLabel({ kind: 'none' })).toBe('all')
})
