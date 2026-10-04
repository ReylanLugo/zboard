import type { On, Timer } from 'claude-code'
import type { Io } from '../runtime/io.ts'

import type { Board } from '../domain/types.ts'

export const ENGRAM_TOOLS = ['mcp__engram__mem_save', 'mcp__engram__mem_search', 'mcp__engram__mem_get_observation'] as const
export const MAX_ARTIFACT_CHARS = 50_000
export const DEBOUNCE_MS = 10_000
export const TOPIC_MARKER = 'zboard-topic: '
const RESERVED = 400
const SEARCH_LIMIT = 5

export const taskTopic = (project: string, change: string, taskId: string): string => `zboard/${project}/${change}/${taskId}`
export const phaseTopic = (project: string, change: string, taskId: string, phase: string, attempt: number): string =>
  `zboard/${project}/${change}/${taskId}/${phase}-${attempt}`
export const indexTopic = (project: string, change: string): string => `zboard/${project}/${change}/index`
export const activeTopic = (project: string): string => `zboard/${project}/active`
export const projectOf = (root: string): string => root.split('/').filter(part => part !== '').at(-1) ?? 'project'

export function truncateArtifact(text: string, transcriptPath?: string): string {
  if (text.length <= MAX_ARTIFACT_CHARS - RESERVED) return text
  const keep = MAX_ARTIFACT_CHARS - RESERVED - 200
  const path = (transcriptPath ?? 'unavailable').slice(0, 150)
  return `${text.slice(0, keep)}\n\n[zboard: truncated ${text.length - keep} of ${text.length} characters] transcript: ${path}`
}

export function parseIds(text: string): number[] {
  const spelled = [
    ...text.matchAll(/(?:^|\s)#(\d+)\b/gm),
    ...text.matchAll(/\bID:\s*(\d+)/gi),
    ...text.matchAll(/"id"\s*:\s*(\d+)/g),
  ].map(match => Number(match[1]))
  return [...new Set(spelled)].filter(id => Number.isInteger(id) && id > 0)
}

async function callText(io: Io, tool: string, args: Record<string, unknown>): Promise<string | undefined> {
  try {
    const out = await io.tool.call({ tool: tool as `mcp__${string}__${string}`, ...args })
    if (out.deny !== undefined || out.isError === true) return undefined
    return out.text ?? (typeof out.result === 'string' ? out.result : JSON.stringify(out.result))
  } catch {
    return undefined
  }
}

export async function saveTopic(io: Io, topic: string, body: string): Promise<boolean> {
  const content = `${TOPIC_MARKER}${topic}\n${body}`
  const saved = await callText(io, 'mcp__engram__mem_save', {
    title: topic, content, type: 'architecture', topic_key: topic, scope: 'project', capture_prompt: false,
  })
  return saved !== undefined
}

const updatedAtOf = (text: string): number | undefined => {
  const own = /"updatedAt"\s*:\s*(\d+)/.exec(text)?.[1]
  if (own !== undefined) return Number(own)
  const iso = /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?)/.exec(text)?.[1]
  const parsed = iso === undefined ? Number.NaN : Date.parse(iso)
  return Number.isNaN(parsed) ? undefined : parsed
}

const bodyOf = (text: string, topic: string): string => {
  const marker = `${TOPIC_MARKER}${topic}\n`
  const at = text.indexOf(marker)
  return at < 0 ? text : text.slice(at + marker.length)
}

export async function fetchTopic(io: Io, topic: string): Promise<{ text: string; updatedAt?: number } | undefined> {
  const found = await callText(io, 'mcp__engram__mem_search', { query: topic, limit: SEARCH_LIMIT })
  if (found === undefined) return undefined
  const hits: { text: string; updatedAt?: number }[] = []
  for (const id of parseIds(found).slice(0, SEARCH_LIMIT)) {
    const text = await callText(io, 'mcp__engram__mem_get_observation', { id })
    if (text !== undefined && text.includes(topic)) hits.push({ text: bodyOf(text, topic), updatedAt: updatedAtOf(text) })
  }
  return [...hits].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]
}

export interface MirrorTarget {
  readonly project: string
  readonly change: string
}

export interface Mirror {
  markDirty(io: Io, taskIds: readonly string[], onDue: () => Promise<void>): void
  addArtifact(topic: string, text: string): void
  flush(io: Io, target: MirrorTarget, board: Board): Promise<{ ok: boolean; saved: number }>
  hasPending(): boolean
}

export function createMirror(): Mirror {
  let dirty: ReadonlySet<string> = new Set()
  let artifacts: ReadonlyMap<string, string> = new Map()
  let timer: Timer | undefined
  let rev = 0

  const saveAll = async (io: Io, target: MirrorTarget, board: Board, ids: readonly string[]) => {
    const now = await io.clock.now()
    const failedIds: string[] = []
    for (const id of ids) {
      const task = board.tasks[id]
      rev += 1
      if (task !== undefined && !(await saveTopic(io, taskTopic(target.project, target.change, id), JSON.stringify({ rev, updatedAt: now, task })))) failedIds.push(id)
    }
    rev += 1
    const index = { rev, updatedAt: now, running: board.running, paused: board.paused, scope: board.scope, tasks: board.order }
    const indexOk = await saveTopic(io, indexTopic(target.project, target.change), JSON.stringify(index))
    const activeOk = await saveTopic(io, activeTopic(target.project), JSON.stringify({ rev, updatedAt: now, change: target.change }))
    return { failedIds, ok: indexOk && activeOk }
  }

  return {
    markDirty(io, taskIds, onDue) {
      if (taskIds.length === 0) return
      dirty = new Set([...dirty, ...taskIds])
      if (timer !== undefined) return
      timer = io.clock.after(DEBOUNCE_MS, () => {
        timer = undefined
        void onDue()
      })
    },
    addArtifact(topic, text) {
      artifacts = new Map([...artifacts, [topic, text]])
    },
    async flush(io, target, board) {
      timer?.cancel()
      timer = undefined
      const ids = [...dirty]
      const queued = [...artifacts]
      dirty = new Set()
      artifacts = new Map()
      const failedArtifacts: (readonly [string, string])[] = []
      for (const [topic, text] of queued) if (!(await saveTopic(io, topic, text))) failedArtifacts.push([topic, text] as const)
      const { failedIds, ok } = await saveAll(io, target, board, ids)
      const retryIds = ok ? failedIds : ids
      dirty = new Set([...dirty, ...retryIds])
      artifacts = new Map([...artifacts, ...failedArtifacts])
      const allOk = ok && failedIds.length === 0 && failedArtifacts.length === 0
      return { ok: allOk, saved: allOk ? ids.length + queued.length + 2 : 0 }
    },
    hasPending() {
      return dirty.size > 0 || artifacts.size > 0
    },
  }
}

export const mirror = createMirror()

/** zboard's own Engram calls are allowed; every other caller goes to the normal permission path. */
export function installEngramAllow(on: On): void {
  on('tool.check', async ($, e, next) => {
    const isOwn = next.origin.plugin === $.plugin.name
    const isEngram = (ENGRAM_TOOLS as readonly string[]).includes(e.tool)
    return isOwn && isEngram ? { decision: 'allow' as const, reason: 'zboard mirrors its board state to Engram' } : next(e)
  })
}
