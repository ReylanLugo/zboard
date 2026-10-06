import type { Io } from './io.ts'

import { changeFiles } from '../adapters/artifacts.ts'
import { parseTasksMd } from '../adapters/tasks-md.ts'
import type { ParsedTask } from '../domain/events.ts'
import type { ChangeRecord } from '../plan/types.ts'
import { TASKS_ARTIFACT, changeDir, isPlanChangeName } from '../plan/types.ts'
import { message } from './log-store.ts'
import { specFilesOf } from './plan-catalog.ts'

/** The Markdown element draws at most 10 000 characters; longer artifacts are clipped with a note. */
export const MARKDOWN_MAX = 9_500

export interface DocFile {
  readonly path: string
  readonly text: string
}

export interface ChangeDocs {
  readonly summary: readonly DocFile[]
  readonly specs: readonly DocFile[]
  readonly tasks?: DocFile
  readonly parsedTasks: readonly ParsedTask[]
  readonly error?: string
}

export const EMPTY_DOCS: ChangeDocs = { summary: [], specs: [], parsedTasks: [] }

export const clipMarkdown = (text: string): string =>
  (text.length <= MARKDOWN_MAX ? text : `${text.slice(0, MARKDOWN_MAX)}\n\n… (truncated: ${text.length - MARKDOWN_MAX} more characters; open the file to read all of it)`)

/** Read while drawing, so it never writes and never throws: a failure becomes `error`. */
export async function readDocs(io: Io, rec: ChangeRecord | undefined): Promise<ChangeDocs> {
  if (rec === undefined || rec.archived || !isPlanChangeName(rec.id)) return EMPTY_DOCS
  try {
    const files = await changeFiles(io, rec.id)
    const dir = changeDir(rec.id)
    const tasksOutput = rec.status?.artifacts.find(artifact => artifact.id === TASKS_ARTIFACT)?.path ?? 'tasks.md'
    const tasks = files.find(file => file.path === `${dir}/${tasksOutput}`)
    const order = (rec.status?.artifacts ?? []).map(artifact => artifact.path).filter(path => !path.includes('*') && path !== tasksOutput)
    const summary = order.flatMap(path => files.filter(file => file.path === `${dir}/${path}`))
    return { summary, specs: specFilesOf(files, rec.id), ...(tasks === undefined ? {} : { tasks }), parsedTasks: tasks === undefined ? [] : parseTasksMd(tasks.text).tasks }
  } catch (error) {
    return { ...EMPTY_DOCS, error: message(error) }
  }
}
