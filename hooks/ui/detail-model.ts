import { displayModel } from '../domain/config.ts'
import type { Task } from '../domain/types.ts'
import { formatElapsed, formatTokens, heartbeat } from './format.ts'

export interface DetailSection {
  readonly title: string
  readonly lines: readonly string[]
}

export function detailSections(task: Task, now: number): DetailSection[] {
  const mark = task.status === 'done' ? '✓' : '○'
  const phases = task.phases.map(record =>
    `${record.phase} #${record.attempt} (loop ${record.loop}): ${record.gate === 'pass' ? '✓' : '✗'} ${record.summary ?? record.reason ?? ''}`.trimEnd())
  const runs = task.agents.map(run => {
    const state = run.outcome ?? (run.endedAt === undefined ? 'running' : 'stopped')
    return `${heartbeat(run, now)} ${run.agentType} ${displayModel(run.model)}/${run.effort ?? 'n/a'} · ${formatElapsed((run.endedAt ?? now) - run.startedAt)} · ${formatTokens(run.tokens)} tok · ${state}`
  })
  const comments = task.comments.flatMap(comment => [
    `${comment.author}: ${comment.text}`,
    comment.deliveredTo === undefined ? '  pending delivery' : `  delivered to ${comment.deliveredTo}`,
  ])
  return [
    { title: 'Acceptance', lines: task.description.split('\n').map(line => `${mark} ${line}`) },
    { title: 'Phases', lines: phases.length === 0 ? ['(no phase finished yet)'] : phases },
    { title: 'Runs', lines: runs.length === 0 ? ['(no agent yet)'] : runs },
    { title: 'Comments', lines: comments.length === 0 ? ['(no comments)'] : comments },
  ]
}

export const latestArtifactKey = (task: Task): string | undefined =>
  [...task.phases].reverse().find(record => record.artifactKey !== undefined)?.artifactKey
