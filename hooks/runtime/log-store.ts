import type { EventBody } from '../domain/events.ts'
import type { LogState } from '../domain/log.ts'
import { appendEvents, boardOf } from '../domain/log.ts'
import type { Board } from '../domain/types.ts'
import type { Io } from './io.ts'

export type AppendListener = (io: Io, before: Board, after: Board, events: readonly EventBody[]) => Promise<void>

const listeners: AppendListener[] = []

export const onAppend = (listener: AppendListener): void => {
  listeners.push(listener)
}

export const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export const readLog = (io: Io): Promise<LogState> => io.state.log.read()

export const readBoard = async (io: Io): Promise<Board> => boardOf(await readLog(io))

export async function append(io: Io, bodies: readonly EventBody[], changeId?: string): Promise<Board> {
  if (bodies.length === 0) return readBoard(io)
  const at = await io.clock.now()
  let before: Board | undefined
  const state = await io.state.log.update(current => {
    before = boardOf(current)
    return appendEvents(current, bodies, at, changeId ?? before.changeId ?? '').state
  })
  const after = boardOf(state)
  io.ui.invalidate()
  for (const listener of listeners) {
    await listener(io, before ?? after, after, bodies).catch(error => {
      io.ui.debug(`zboard: an append listener failed: ${message(error)}`)
    })
  }
  return after
}

export async function recordModError(io: Io, hook: string, error: unknown, taskId?: string): Promise<void> {
  try {
    await append(io, [{ type: 'ModError', hook, message: message(error), ...(taskId === undefined ? {} : { taskId }) }])
  } catch (inner) {
    io.ui.debug(`zboard: ${hook} failed (${message(error)}) and could not be recorded: ${message(inner)}`)
  }
}

/**
 * Runs a hook's work and records a failure instead of letting it escape, so a
 * broken hook behaves as if it were absent. (Claude Code only accepts function
 * literals as `.catch` handlers, so isolation is a wrapper the hook calls.)
 */
export async function isolate<T>(io: Io, hook: string, work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work()
  } catch (error) {
    await recordModError(io, hook, error)
    return fallback
  }
}

export async function isolateTask(io: Io, hook: string, taskId: string, work: () => Promise<void>): Promise<void> {
  try {
    await work()
  } catch (error) {
    await recordModError(io, hook, error, taskId)
  }
}

export async function putArtifact(io: Io, key: string, text: string): Promise<void> {
  await io.state.artifacts.update(all => ({ ...all, [key]: text }))
}

export const getArtifact = async (io: Io, key: string): Promise<string | undefined> =>
  (await io.state.artifacts.read())[key]
