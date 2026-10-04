import type { EventBody } from '../domain/events.ts'
import { unique } from '../domain/json.ts'
import type { Board, TaskStatus } from '../domain/types.ts'
import type { Io } from './io.ts'
import { append, readBoard } from './log-store.ts'

const STATUS_OF: Readonly<Record<string, TaskStatus>> = { pending: 'ready', in_progress: 'running', completed: 'done' }

export const nativeId = (id: string): string => `n${id}`

export interface NativeUpdate {
  readonly status?: string
  readonly subject?: string
  readonly description?: string
  readonly addBlocks?: readonly string[]
  readonly addBlockedBy?: readonly string[]
}

export function nativeUpdate(board: Board, taskId: string, input: NativeUpdate): EventBody[] {
  const task = board.tasks[taskId]
  if (task === undefined) return []
  if (input.status === 'deleted') return [{ type: 'TaskRemoved', taskId }]
  const blockedBy = (input.addBlockedBy ?? []).map(nativeId)
  const patch = {
    ...(input.subject === undefined ? {} : { title: input.subject }),
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(blockedBy.length === 0 ? {} : { dependsOn: unique([...task.dependsOn, ...blockedBy]) }),
  }
  const to = input.status === undefined ? undefined : STATUS_OF[input.status]
  const blocks: EventBody[] = (input.addBlocks ?? []).map(nativeId).flatMap(id => {
    const other = board.tasks[id]
    return other === undefined ? [] : [{ type: 'TaskUpdated' as const, taskId: id, patch: { dependsOn: unique([...other.dependsOn, taskId]) } }]
  })
  return [
    ...(Object.keys(patch).length === 0 ? [] : [{ type: 'TaskUpdated' as const, taskId, patch }]),
    ...(to === undefined || to === task.status ? [] : [{ type: 'TaskStatusChanged' as const, taskId, from: task.status, to }]),
    ...blocks,
  ]
}

type NativeResult = { readonly deny?: string; readonly isError?: boolean; readonly result?: unknown }

/** Mirrors a successful TaskCreate; its hook (register.tsx) always returns the native result. */
export async function mirrorCreated(io: Io, ran: NativeResult, input: { readonly subject?: string; readonly description?: string }): Promise<void> {
  const created = ran.deny === undefined && ran.isError !== true ? (ran.result as { task?: { id?: unknown } } | undefined) : undefined
  const id = created?.task?.id
  if (typeof id !== 'string') return
  await append(io, [{ type: 'TaskCreated', task: { id: nativeId(id), title: input.subject ?? '', description: input.description, source: 'native' } }])
}

/** Mirrors a successful TaskUpdate; its hook (register.tsx) always returns the native result. */
export async function mirrorUpdated(io: Io, ran: NativeResult, taskId: string, input: NativeUpdate): Promise<void> {
  if (ran.deny !== undefined || ran.isError === true) return
  await append(io, nativeUpdate(await readBoard(io), nativeId(taskId), input))
}
