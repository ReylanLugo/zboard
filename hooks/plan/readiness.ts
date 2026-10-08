import type { ParsedTask } from '../domain/events.ts'
import type { ReadinessCheck, ReadinessId } from './types.ts'

export const TASK_TEXT_MAX = 600
export const GROUP_TASK_MAX = 12

export interface SpecFile {
  readonly path: string
  readonly text: string
}

export interface Requirement {
  readonly name: string
  readonly path: string
  readonly scenarios: readonly string[]
}

export interface ReadinessInput {
  /** `onlyNoDelta`: openspec's sole issue is the "no deltas" one, shown readably instead of the raw CLI text. */
  readonly validate: { readonly ok: boolean; readonly detail: string; readonly onlyNoDelta?: boolean }
  readonly specs: readonly SpecFile[]
  readonly tasks: readonly ParsedTask[]
  readonly planMd?: string
}

const REQUIREMENT = /^###\s+Requirement:\s*(.+?)\s*$/
const SCENARIO = /^####\s+Scenario:\s*(.+?)\s*$/
const TAG = /\[req:\s*([^\]]+)\]/gi
const ACCEPTANCE_LINE = /^Acceptance:/im
const ACCEPTANCE_HEADING = /^\s*(?:#{2,6}\s*|\*\*)Acceptance\b/im

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function parseRequirements(specs: readonly SpecFile[]): Requirement[] {
  return specs.flatMap(spec => {
    const found: { name: string; scenarios: string[] }[] = []
    for (const raw of spec.text.split('\n')) {
      const line = raw.replace(/\r$/, '')
      const requirement = REQUIREMENT.exec(line)
      const scenario = SCENARIO.exec(line)
      if (requirement !== null) found.push({ name: requirement[1] ?? '', scenarios: [] })
      else if (scenario !== null) found.at(-1)?.scenarios.push(scenario[1] ?? '')
    }
    return found.map(requirement => ({ ...requirement, path: spec.path }))
  })
}

const tagsOf = (text: string): string[] =>
  [...text.matchAll(TAG)].flatMap(match => (match[1] ?? '').split(';').map(name => name.trim().toLowerCase()).filter(name => name !== ''))

/** A task names a requirement by its exact name (case-insensitive) or by a `[req: <name>; <name>]` tag. */
export function namedRequirements(task: ParsedTask, names: readonly string[]): string[] {
  const text = task.description.toLowerCase()
  const tags = new Set(tagsOf(task.description))
  return names.filter(name => tags.has(name.toLowerCase()) || text.includes(name.toLowerCase()))
}

export function coveringTasks(requirements: readonly Requirement[], tasks: readonly ParsedTask[]): Record<string, string[]> {
  const names = requirements.map(requirement => requirement.name)
  return Object.fromEntries(names.map(name => [name, tasks.filter(task => namedRequirements(task, [name]).length > 0).map(task => task.label)]))
}

export function findCycle(tasks: readonly ParsedTask[]): string[] | undefined {
  const deps = new Map(tasks.map(task => [task.label, task.dependsOn.filter(dep => dep !== task.label)]))
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (label: string, path: readonly string[]): string[] | undefined => {
    if (state.get(label) === 'done') return undefined
    if (state.get(label) === 'visiting') return [...path.slice(path.indexOf(label)), label]
    state.set(label, 'visiting')
    for (const dep of deps.get(label) ?? []) {
      if (!deps.has(dep)) continue
      const found = visit(dep, [...path, label])
      if (found !== undefined) return found
    }
    state.set(label, 'done')
    return undefined
  }
  for (const task of tasks) {
    const found = visit(task.label, [])
    if (found !== undefined) return found
  }
  return undefined
}

function planSection(planMd: string | undefined, label: string): string {
  if (planMd === undefined) return ''
  const lines = planMd.replace(/\r/g, '').split('\n')
  const heading = new RegExp(`^#{2,4}\\s+Task\\s+${escapeRegExp(label)}(?![.\\d])`)
  const start = lines.findIndex(line => heading.test(line))
  if (start < 0) return ''
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(line => /^#{2,3}\s/.test(line))
  return (end < 0 ? rest : rest.slice(0, end)).join('\n')
}

const check = (id: ReadinessId, failures: readonly string[], okDetail: string): ReadinessCheck =>
  (failures.length === 0 ? { id, ok: true, detail: okDetail } : { id, ok: false, detail: failures.join('; ') })

function sizeFailures(tasks: readonly ParsedTask[]): string[] {
  const long = tasks.filter(task => task.description.length > TASK_TEXT_MAX).map(task => `${task.label} is ${task.description.length} characters (max ${TASK_TEXT_MAX})`)
  const sections = [...new Set(tasks.map(task => task.section))]
  const crowded = sections
    .map(section => [section, tasks.filter(task => task.section === section).length] as const)
    .filter(([, count]) => count > GROUP_TASK_MAX)
    .map(([section, count]) => `${section} has ${count} tasks (max ${GROUP_TASK_MAX})`)
  return [...long, ...crowded]
}

export const NO_DELTA_DETAIL = 'no delta spec yet'

const validateCheck = (validate: ReadinessInput['validate']): ReadinessCheck =>
  (validate.onlyNoDelta === true ? { id: 'validate', ok: false, detail: NO_DELTA_DETAIL } : { id: 'validate', ok: validate.ok, detail: validate.detail })

/** D11: six mechanical, free checks; each failure names what failed. */
export function readinessChecks(input: ReadinessInput): ReadinessCheck[] {
  const requirements = parseRequirements(input.specs)
  const names = requirements.map(requirement => requirement.name)
  const cycle = findCycle(input.tasks)
  return [
    validateCheck(input.validate),
    check('scenarios', requirements.filter(r => r.scenarios.length === 0).map(r => `${r.name} has no scenario`), `${requirements.length} requirement(s) with scenarios`),
    check('coverage', input.tasks.filter(task => namedRequirements(task, names).length === 0).map(task => `${task.label} names no requirement`), 'every task names a requirement'),
    check('cycles', cycle === undefined ? [] : [`cycle: ${cycle.join(' → ')}`], 'no dependency cycle'),
    check('size', sizeFailures(input.tasks), 'task and group sizes within limits'),
    check('acceptance', input.tasks
      .filter(task => !ACCEPTANCE_LINE.test(task.description) && !ACCEPTANCE_HEADING.test(planSection(input.planMd, task.label)))
      .map(task => `${task.label} has no acceptance criteria`), 'every task has acceptance criteria'),
  ]
}
