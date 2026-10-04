import type { Io } from './io.ts'

import type { Baseline } from '../adapters/git.ts'
import { snapshot, touchedBetween } from '../adapters/git.ts'
import { tasksPath } from '../adapters/openspec.ts'
import { runScoped } from '../adapters/ptest.ts'
import type { GateOutcome } from '../domain/gates.ts'
import { fail, greenGate, planGate, researchGate, reviewGate, tddGate, tddTestFiles, touchedGate } from '../domain/gates.ts'
import { unique } from '../domain/json.ts'
import { activeRun } from '../domain/project.ts'
import type { AgentRun, Board, Task } from '../domain/types.ts'

export interface Evaluation {
  readonly outcome: GateOutcome
  readonly touched: readonly string[]
  readonly testFiles?: readonly string[]
}

/** Files another running task may change; their changes are attributed to that task. */
const othersScope = (board: Board, taskId: string): ReadonlySet<string> =>
  new Set(Object.values(board.tasks)
    .filter(task => task.id !== taskId && activeRun(task) !== undefined)
    .flatMap(task => [...task.allowedFiles, ...task.testFiles]))

/** Paths zboard committed for the change's other finished tasks. */
const committedByOthers = (board: Board, taskId: string): ReadonlySet<string> =>
  new Set(Object.values(board.tasks)
    .filter(task => task.id !== taskId && task.status === 'done')
    .flatMap(task => task.touched))

/**
 * Changes zboard itself made while the phase ran: the tasks.md checkbox flips, and
 * another task's commit, seen as a path dirty in the baseline that is clean now.
 * A path the phase edits after such a commit is dirty again, so it still counts.
 */
function zboardChanges(board: Board, task: Task, baseline: Baseline, after: Baseline): (path: string) => boolean {
  const committed = committedByOthers(board, task.id)
  const flips = tasksPath(task.changeId)
  return path => path === flips || (committed.has(path) && baseline[path] !== undefined && after[path] === undefined)
}

export async function evaluateStop(
  io: Io, board: Board, task: Task, run: AgentRun, answer: string, root: string,
): Promise<Evaluation> {
  const others = othersScope(board, task.id)
  const after = await snapshot(io, root)
  const ownedByZboard = zboardChanges(board, task, run.baseline, after)
  const touched = touchedBetween(run.baseline, after).filter(path => !others.has(path) && !ownedByZboard(path))
  if (answer.trim() === '') return { outcome: fail(`${run.phase}: the agent ended without an artifact`), touched }
  switch (run.phase) {
    case 'research':
      return { outcome: touchedGate(touched, [], 'research') ?? researchGate(answer), touched }
    case 'plan':
      return { outcome: touchedGate(touched, [], 'plan') ?? planGate(answer, root), touched }
    case 'review':
      return { outcome: touchedGate(touched, [], 'review') ?? reviewGate(answer), touched }
    case 'tdd': {
      const testFiles = unique([...task.testFiles, ...tddTestFiles(answer, root)])
      const outcome = touchedGate(touched, testFiles, 'tdd') ?? tddGate(await runScoped(io, testFiles, root), answer)
      return { outcome, touched, testFiles }
    }
    case 'code':
    case 'refactor': {
      const scope = touchedGate(touched, [...task.allowedFiles, ...task.testFiles], run.phase)
      return { outcome: scope ?? greenGate(await runScoped(io, task.testFiles, root), run.phase), touched }
    }
  }
}
