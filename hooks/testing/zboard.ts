import type { PromptSubmitResult } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import type { Task } from '../domain/types.ts'
import type { StatusView } from '../tools/views.ts'
import type { ProcessAnswer, World } from './world.ts'
import { argvIs, handbackRow } from './world.ts'

export const TASKS_PATH = '/repo/openspec/changes/demo/tasks.md'
export const ONE_TASK = '## 1. Core\n\n- [ ] 1.1 Parse tasks\n'
export const TWO_TASKS = '## 1. Core\n\n- [ ] 1.1 Parse tasks\n- [ ] 1.2 Flip lines\n'

export const json = (value: unknown): string => `Result:\n\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\`\n`

export const ANSWERS = {
  research: json({ findings: [{ claim: 'the parser lives here', evidence: 'src/a.ts:1' }], risks: [], existingTests: [] }),
  plan: json({ approach: 'split lines', allowedFiles: ['src/a.ts'], testFiles: ['tests/a.test.ts'], testCases: ['keeps multiline'], edgeCases: [], risks: [] }),
  tdd: json({ testFiles: ['tests/a.test.ts'], newTests: ['keeps multiline'] }),
  code: json({ summary: 'implemented', files: ['src/a.ts'] }),
  approve: json({ verdict: 'approve', findings: [] }),
  changes: json({ verdict: 'changes', findings: [{ severity: 'medium', file: 'src/a.ts', issue: 'unclear name' }] }),
  refactor: json({ summary: 'renamed', fixed: ['unclear name'] }),
} as const

export const RED: ProcessAnswer = { exitCode: 1, stdout: ' FAIL  tests/a.test.ts > parser > keeps multiline\n', stderr: 'ptest: demo · failed · 1 test\n' }
export const GREEN: ProcessAnswer = { exitCode: 0, stderr: 'ptest: demo · passed · 3 tests\n' }
export const INCOMPLETE: ProcessAnswer = { exitCode: 70, stderr: 'ptest: incomplete (exit 70)\n' }

export async function boot($: Engine): Promise<void> {
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
}

export async function zboard($: Engine, args: string): Promise<string> {
  return (await $.command.run({ command: 'zboard', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 160 } })).text ?? ''
}

export async function callTool($: Engine, name: string, args: Record<string, unknown> = {}): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  const out = await $.tool.call({ tool: `mcp__zboard__${name}`, ...args } as Parameters<typeof $.tool.call>[0])
  if (out.deny !== undefined) return { ok: false, error: out.deny }
  return { ok: true, value: JSON.parse(String(out.result)) as unknown }
}

async function read<T>($: Engine, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const out = await callTool($, name, args)
  if (!out.ok) throw new Error(out.error)
  return out.value as T
}

export const status = ($: Engine): Promise<StatusView> => read($, 'board_status')
export const taskOf = ($: Engine, taskId: string): Promise<Task> => read($, 'board_task', { taskId })
export const agentOf = ($: Engine, agentId: string): Promise<Record<string, unknown>> => read($, 'board_agent', { agentId })

const TASKS_REL = 'openspec/changes/demo/tasks.md'

/** A stable stand-in for a blob hash (no newline, so `git hash-object` output stays one line per path). */
const fakeHash = (text: string): string => {
  let hash = 5381
  for (const char of text) hash = ((hash * 33) ^ char.charCodeAt(0)) >>> 0
  return `md${hash.toString(16)}`
}

const pathsAfterDashes = (argv: readonly string[]): string[] => argv.slice(argv.indexOf('--') + 1)

/**
 * Models the working tree: tests set paths in the returned map to simulate an agent's edits.
 * Like git, a commit cleans the committed paths, and tasks.md shows as modified once its
 * content differs from the committed one (a flip dirties it).
 */
export function scriptGit(w: World): Map<string, string> {
  const dirty = new Map<string, string>()
  let committedTasks = w.files.get(TASKS_PATH)
  let staged: string[] = []
  const tree = (): Map<string, string> => {
    const text = w.files.get(TASKS_PATH)
    return text === committedTasks || text === undefined ? dirty : new Map([...dirty, [TASKS_REL, fakeHash(text)]])
  }
  const commit = (argv: readonly string[]): ProcessAnswer => {
    for (const path of pathsAfterDashes(argv)) {
      dirty.delete(path)
      if (path === TASKS_REL) committedTasks = w.files.get(TASKS_PATH)
    }
    return {}
  }
  w.rules.push({ match: argvIs('git', 'status'), answer: () => ({ stdout: [...tree().keys()].map(path => `?? ${path}\0`).join('') }) })
  w.rules.push({ match: argvIs('git', 'hash-object'), answer: argv => ({ stdout: `${argv.slice(3).map(path => tree().get(path) ?? 'missing').join('\n')}\n` }) })
  w.rules.push({ match: argvIs('git', 'add'), answer: argv => { staged = argv.slice(3); return {} } })
  w.rules.push({ match: argvIs('git', 'commit'), answer: commit })
  w.rules.push({ match: argvIs('git', 'show'), answer: () => ({ stdout: `c0ffee1234\n\n${staged.join('\n')}\n` }) })
  return dirty
}

export function scriptPtest(w: World, answers: readonly ProcessAnswer[]): void {
  scriptRunner(w, ['ptest'], answers)
}

/** Answers the next runs of a test command whose argv starts with `prefix`, one answer per run. */
export function scriptRunner(w: World, prefix: readonly string[], answers: readonly ProcessAnswer[]): void {
  for (const answer of answers) w.rules.push({ match: argvIs(...prefix), once: true, answer })
}

export function setupDemo(w: World, tasksMd: string = ONE_TASK): Map<string, string> {
  w.files.set(TASKS_PATH, tasksMd)
  return scriptGit(w)
}

/**
 * Ends a zboard-spawned agent as the engine does. Its run reports through the
 * SubagentHandback tool (its messages hold the call) and ends with no text: the
 * run's `turn.complete` with an empty answer completes it (a SubagentStop that
 * follows is a no-op). The report then reaches the main session as a peer message.
 * The clock does not move: the completion and every spawn it makes are awaited
 * inside the hook.
 */
export async function stopAgent($: Engine, w: World, agentId: string, answer?: string): Promise<void> {
  if (answer !== undefined) w.transcripts.set(agentId, [...(w.transcripts.get(agentId) ?? []), handbackRow(answer)])
  await completeTurn($, agentId, '')
  if (answer !== undefined) await deliverPeer($, agentId, answer)
}

/** An agent whose run ends with text: the engine's `turn.complete` carries it as `answer`. */
export async function stopAgentWithText($: Engine, w: World, agentId: string, answer: string): Promise<void> {
  await completeTurn($, agentId, answer)
}

async function completeTurn($: Engine, agentId: string, answer: string): Promise<void> {
  await $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId: `turn-${agentId}`, agentId, reason: 'answer' })
}

/**
 * An agent whose SubagentStop does reach zboard (the only event carrying its
 * transcript path), its report in its messages.
 */
export async function stopAgentBySubagentStop($: Engine, w: World, agentId: string, answer: string): Promise<void> {
  w.transcripts.set(agentId, [...(w.transcripts.get(agentId) ?? []), handbackRow(answer)])
  await $.classic.SubagentStop({ stop_hook_active: false, agent_id: agentId, agent_transcript_path: `/t/${agentId}.jsonl`, agent_type: 'zboard' })
}

/** A hand-back as the main session receives it: a peer turn naming the agent. */
export const agentMessage = (agentId: string, report: string): string => `<agent-message from="${agentId}">\n${report}\n</agent-message>`

export async function deliverPeer($: Engine, agentId: string, report: string): Promise<PromptSubmitResult> {
  return $.prompt.submit({ text: agentMessage(agentId, report), wait: false, origin: { kind: 'peer' } })
}

export const lastAgent = (w: World): string => w.spawns.at(-1)?.agentId ?? ''

export function seedEngram(w: World, topic: string, body: string): void {
  w.saved.push({ id: w.saved.length + 1, topic, content: `zboard-topic: ${topic}\n${body}` })
}
