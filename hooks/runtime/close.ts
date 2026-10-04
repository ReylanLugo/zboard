import type { Io } from './io.ts'

import type { Task } from '../domain/types.ts'
import { append } from './log-store.ts'

export async function closeTask(io: Io, task: Task): Promise<void> {
  await append(io, [{ type: 'TaskStatusChanged', taskId: task.id, from: task.status, to: 'done', reason: 'review approved' }])
}
