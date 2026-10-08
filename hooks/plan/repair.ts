import type { ReadinessCheck } from './types.ts'

export interface RepairTargets {
  /** Task labels the coverage check says name no requirement. */
  readonly noRequirement: readonly string[]
  /** Task labels the acceptance check says have no acceptance criteria. */
  readonly noAcceptance: readonly string[]
}

const failedSubjects = (checks: readonly ReadinessCheck[], id: ReadinessCheck['id']): readonly string[] => {
  const found = checks.find(check => check.id === id && !check.ok)
  return found?.subjects ?? []
}

export const repairTargets = (checks: readonly ReadinessCheck[]): RepairTargets =>
  ({ noRequirement: failedSubjects(checks, 'coverage'), noAcceptance: failedSubjects(checks, 'acceptance') })

/** True while the coverage or acceptance check fails: the two checks a tasks.md rewrite can fix. */
export const needsRepair = (checks: readonly ReadinessCheck[]): boolean =>
  checks.some(check => !check.ok && (check.id === 'coverage' || check.id === 'acceptance'))

const missing = (label: string, tasks: readonly string[]): string[] => (tasks.length === 0 ? [] : [`- ${label}: ${tasks.join(', ')}`])

/** The comment that asks the drafter to add `[req: …]` tags and `Acceptance:` lines without touching anything else. */
export function repairInstruction(requirements: readonly string[], targets: RepairTargets): string {
  const gaps = [...missing('no requirement tag', targets.noRequirement), ...missing('no acceptance line', targets.noAcceptance)]
  return [
    'Rewrite tasks.md so every task names the requirement it implements and states how it is accepted.',
    'For every task that lacks them, add a `[req: <Requirement name>]` tag at the end of the task line and an indented `Acceptance: …` line below it.',
    'Do not change task ids, order, checkbox state or any wording otherwise; keep every task that already has them as it is.',
    '',
    'Requirement names available (use them exactly):',
    ...(requirements.length === 0 ? ['- (none found in the specs)'] : requirements.map(name => `- ${name}`)),
    '',
    gaps.length === 0 ? 'Apply this to every task that lacks them.' : 'Tasks that miss them:',
    ...gaps,
  ].join('\n')
}
