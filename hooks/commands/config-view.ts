import type { Io } from '../runtime/io.ts'

import { readProjectConfig } from '../adapters/config-io.ts'
import { runnerOf } from '../adapters/test-runner.ts'
import type { ProjectConfig } from '../domain/config.ts'
import { EFFORTS, MODELS, configWarnings, globalLayer, isEffort, isModel, resolveChoice } from '../domain/config.ts'
import type { Board, Role } from '../domain/types.ts'
import { ROLES, agentTypeOf } from '../domain/types.ts'
import type { Ctx } from '../runtime/ctx.ts'
import { append, readBoard } from '../runtime/log-store.ts'

type Options = Readonly<Record<string, unknown>>

/** The effective test command (argv template) and where it comes from. */
function testCommandLine(project: ProjectConfig): string {
  const runner = runnerOf(project)
  if (runner.kind === 'ptest') return `test command: ${JSON.stringify(['ptest', '{file}'])} (default (ptest))`
  return `test command: ${JSON.stringify(runner.argv)} (project), timeout ${runner.timeoutMs} ms`
}

export function configLines(project: ProjectConfig, options: Options, board: Board): string[] {
  const rows = ROLES.map(role => {
    const resolved = resolveChoice(role, { project: project.layers[role], global: globalLayer(options, role) }, { loop: 0, autoEscalate: false })
    return `${agentTypeOf(role)}: ${resolved.model} (${resolved.modelSource}) / ${resolved.effort ?? 'n/a'} (${resolved.effortSource})`
  })
  const overrides = board.order.flatMap(id =>
    Object.entries(board.tasks[id]?.overrides ?? {}).map(([role, choice]) => `  task ${id} ${role}: ${choice.model ?? '(inherited)'} / ${choice.effort ?? '(inherited)'}`))
  const autoEscalate = project.autoEscalate ?? options.autoEscalate === true
  return [
    'zboard agent configuration — value (source):',
    ...rows,
    `auto-escalation: ${autoEscalate ? 'on' : 'off'}`,
    testCommandLine(project),
    ...(overrides.length === 0 ? [] : ['task overrides:', ...overrides]),
  ]
}

export async function showConfig(io: Io, ctx: Ctx): Promise<string> {
  const project = await readProjectConfig(io)
  const warnings = configWarnings(project, ctx.options).map(warning => `⚠ ${warning}`)
  return [...configLines(project, ctx.options, await readBoard(io)), ...warnings].join('\n')
}

export async function setOverride(
  io: Io, command: { readonly label: string; readonly role: string; readonly model: string; readonly effort: string },
): Promise<string> {
  const board = await readBoard(io)
  if (board.tasks[command.label] === undefined) return `zboard: unknown task ${command.label}`
  if (!(ROLES as readonly string[]).includes(command.role)) return `zboard: unknown agent ${command.role} (${ROLES.join(', ')})`
  if (!isModel(command.model)) return `zboard: unknown model "${command.model}" (${Object.keys(MODELS).join(', ')})`
  if (!isEffort(command.effort)) return `zboard: unknown effort "${command.effort}" (${EFFORTS.join(', ')})`
  const role = command.role as Role
  await append(io, [{ type: 'TaskUpdated', taskId: command.label, patch: { overrides: { [role]: { model: command.model, effort: command.effort } } } }])
  return `zboard: task ${command.label} ${agentTypeOf(role)} will use ${command.model} / ${command.effort}`
}
