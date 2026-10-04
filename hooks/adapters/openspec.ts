import type { Io } from '../runtime/io.ts'

import type { ParsedTask } from '../domain/events.ts'
import { flipLine, parseTasksMd } from './tasks-md.ts'

const CHANGE_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/i

export const isChangeName = (name: string): boolean => CHANGE_NAME.test(name) && !name.includes('..')

export const tasksPath = (change: string): string => `openspec/changes/${change}/tasks.md`

export type LoadResult =
  | { readonly ok: true; readonly tasks: readonly ParsedTask[]; readonly unparsed: readonly string[]; readonly text: string }
  | { readonly ok: false; readonly reason: string }

const readText = async (io: Io, path: string): Promise<string | undefined> => {
  const text = await io.fs.read(path).catch(() => undefined)
  return typeof text === 'string' ? text : undefined
}

export async function loadChange(io: Io, change: string): Promise<LoadResult> {
  if (!isChangeName(change)) return { ok: false, reason: `invalid change name: ${change}` }
  const text = await readText(io, tasksPath(change))
  if (text === undefined) return { ok: false, reason: `no tasks.md for change ${change}` }
  return { ok: true, ...parseTasksMd(text), text }
}

export async function flipTask(
  io: Io,
  change: string,
  label: string,
  expectedLine: string,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }> {
  const text = await readText(io, tasksPath(change))
  if (text === undefined) return { ok: false, reason: 'tasks.md cannot be read' }
  const flipped = flipLine(text, label, expectedLine)
  if (!flipped.ok) return flipped
  await io.fs.write(tasksPath(change), flipped.text)
  return { ok: true }
}
