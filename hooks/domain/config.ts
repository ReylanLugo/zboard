import { isRecord } from './json.ts'
import type { ModelChoice, Role } from './types.ts'
import { ROLES } from './types.ts'

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof EFFORTS)[number]

export const MODELS: Readonly<Record<string, { readonly id: string; readonly supportsEffort: boolean }>> = {
  'opus 5.5': { id: 'claude-opus-5-5', supportsEffort: true },
  'sonnet 5.5': { id: 'claude-sonnet-5-5', supportsEffort: true },
  'haiku 4.5': { id: 'claude-haiku-4-5', supportsEffort: false },
}

export const DEFAULTS: Readonly<Record<Role, { readonly model: string; readonly effort: Effort }>> = {
  researcher: { model: 'sonnet 5.5', effort: 'medium' },
  planner: { model: 'opus 5.5', effort: 'xhigh' },
  tdd: { model: 'sonnet 5.5', effort: 'low' },
  implementer: { model: 'sonnet 5.5', effort: 'medium' },
  reviewer: { model: 'opus 5.5', effort: 'high' },
  refactorer: { model: 'sonnet 5.5', effort: 'medium' },
}

export type Level = 'task' | 'project' | 'global' | 'default'

export interface Layers {
  readonly task?: ModelChoice
  readonly project?: ModelChoice
  readonly global?: ModelChoice
}

export interface Resolved {
  readonly model: string
  readonly modelId: string
  readonly effort?: Effort
  readonly modelSource: Level
  readonly effortSource: Level | 'unsupported' | 'escalated'
  readonly warnings: readonly string[]
}

export interface ProjectConfig {
  readonly layers: Readonly<Partial<Record<Role, ModelChoice>>>
  readonly autoEscalate?: boolean
  readonly warnings: readonly string[]
}

const LEVELS = ['task', 'project', 'global'] as const

export const isEffort = (value: unknown): value is Effort => typeof value === 'string' && (EFFORTS as readonly string[]).includes(value)
export const isModel = (value: unknown): value is string => typeof value === 'string' && Object.hasOwn(MODELS, value)
export const displayModel = (id: string): string => Object.entries(MODELS).find(([, info]) => info.id === id)?.[0] ?? id
export const stepUp = (effort: Effort): Effort => EFFORTS[Math.min(EFFORTS.indexOf(effort) + 1, EFFORTS.length - 1)] ?? 'max'

function pick<T extends string>(
  role: Role, field: 'model' | 'effort', layers: Layers, valid: (value: unknown) => value is T, fallback: T,
): { value: T; source: Level; warnings: string[] } {
  for (const level of LEVELS) {
    const value = layers[level]?.[field]
    if (value === undefined) continue
    if (valid(value)) return { value, source: level, warnings: [] }
    return { value: fallback, source: 'default', warnings: [`${level} ${role} ${field} "${value}" is invalid; using ${fallback}`] }
  }
  return { value: fallback, source: 'default', warnings: [] }
}

export function resolveChoice(role: Role, layers: Layers, opts: { readonly loop: number; readonly autoEscalate: boolean }): Resolved {
  const model = pick(role, 'model', layers, isModel, DEFAULTS[role].model)
  const effort = pick(role, 'effort', layers, isEffort, DEFAULTS[role].effort)
  const info = MODELS[model.value] ?? { id: model.value, supportsEffort: true }
  const base = { model: model.value, modelId: info.id, modelSource: model.source, warnings: [...model.warnings, ...effort.warnings] }
  if (!info.supportsEffort) return { ...base, effortSource: 'unsupported' }
  const escalated = opts.autoEscalate && role === 'refactorer' && opts.loop >= 3
  return escalated
    ? { ...base, effort: stepUp(effort.value), effortSource: 'escalated' }
    : { ...base, effort: effort.value, effortSource: effort.source }
}

export function globalLayer(options: Readonly<Record<string, unknown>>, role: Role): ModelChoice {
  const model = options[`${role}Model`]
  const effort = options[`${role}Effort`]
  return {
    model: typeof model === 'string' && model !== DEFAULTS[role].model ? model : undefined,
    effort: typeof effort === 'string' && effort !== DEFAULTS[role].effort ? effort : undefined,
  }
}

const choiceOf = (value: Record<string, unknown>): ModelChoice => ({
  ...(typeof value.model === 'string' ? { model: value.model } : {}),
  ...(typeof value.effort === 'string' ? { effort: value.effort } : {}),
})

export function parseProjectConfig(text: string | undefined): ProjectConfig {
  if (text === undefined) return { layers: {}, warnings: [] }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { layers: {}, warnings: ['.zboard/config.json is not valid JSON; ignoring it'] }
  }
  if (!isRecord(json)) return { layers: {}, warnings: ['.zboard/config.json must be a JSON object; ignoring it'] }
  const agents = isRecord(json.agents) ? json.agents : {}
  const layers = Object.fromEntries(
    ROLES.flatMap(role => { const value = agents[role]; return isRecord(value) ? [[role, choiceOf(value)] as const] : [] }),
  )
  const unknown = Object.keys(agents).filter(key => !(ROLES as readonly string[]).includes(key))
  return {
    layers,
    ...(typeof json.autoEscalate === 'boolean' ? { autoEscalate: json.autoEscalate } : {}),
    warnings: unknown.map(key => `.zboard/config.json: unknown agent "${key}"`),
  }
}

export function configWarnings(project: ProjectConfig, options: Readonly<Record<string, unknown>>): string[] {
  const resolved = ROLES.flatMap(role =>
    resolveChoice(role, { project: project.layers[role], global: globalLayer(options, role) }, { loop: 0, autoEscalate: false }).warnings)
  return [...project.warnings, ...resolved]
}
