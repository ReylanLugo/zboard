import { mock } from 'claude-code/testing'
import type { AgentSpawnInput, FsStat, On, ProcessRunResult } from 'claude-code'

import type { Io } from '../runtime/io.ts'
import { NATIVE_STATE } from './harness-facts.ts'

export const ROOT = '/repo'
export const NOW = 1_000_000

export interface ProcessAnswer {
  readonly exitCode?: number
  readonly stdout?: string
  readonly stderr?: string
  readonly reject?: string
}

export interface ProcessRule {
  readonly match: (argv: readonly string[]) => boolean
  /** A fixed answer, or one computed from the argv (lets tests model a changing working tree). */
  readonly answer: ProcessAnswer | ((argv: readonly string[]) => ProcessAnswer)
  readonly once?: boolean
}

export interface SpawnRecord {
  readonly agentId: string
  readonly subagentType: string
  readonly prompt: string
  readonly model?: string
}

export interface SavedTopic {
  readonly id: number
  readonly topic: string
  readonly content: string
}

export interface World {
  readonly files: Map<string, string>
  readonly mtimes: Map<string, number>
  readonly links: Map<string, string>
  readonly rules: ProcessRule[]
  readonly runs: string[][]
  readonly spawns: SpawnRecord[]
  readonly agentSpecs: Map<string, Record<string, unknown>>
  readonly tools: string[]
  readonly commands: string[]
  readonly appended: string[]
  readonly toasts: string[]
  readonly opened: string[]
  readonly alive: Set<string>
  readonly saved: SavedTopic[]
  readonly store: Map<string, unknown>
  readonly clock: ReturnType<typeof mock.clock>
  spawnDeny: string | undefined
  engram: 'up' | 'error' | 'missing'
  placePanes: boolean
}

export const argvIs = (...prefix: string[]) => (argv: readonly string[]): boolean =>
  prefix.every((part, index) => argv[index] === part)

export function absPath(path: string): string {
  const joined = path.startsWith('/') ? path : `${ROOT}/${path}`
  const parts: string[] = []
  for (const part of joined.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `/${parts.join('/')}`
}

const realOf = (w: World, path: string): string => {
  for (const [link, target] of w.links) {
    if (path === link || path.startsWith(`${link}/`)) return `${target}${path.slice(link.length)}`
  }
  return path
}

const isDir = (w: World, path: string): boolean =>
  path === ROOT || [...w.files.keys()].some(key => key.startsWith(`${path}/`))

export function installWorld(on: On): World {
  const w: World = {
    files: new Map(),
    mtimes: new Map(),
    links: new Map(),
    rules: [],
    runs: [],
    spawns: [],
    agentSpecs: new Map(),
    tools: [],
    commands: [],
    appended: [],
    toasts: [],
    opened: [],
    alive: new Set(),
    saved: [],
    store: new Map(),
    clock: mock.clock(on, { now: NOW }),
    spawnDeny: undefined,
    engram: 'up',
    placePanes: true,
  }
  installStore(on, w)
  installSession(on, w)
  installFs(on, w)
  installProcess(on, w)
  installAgents(on, w)
  installRegistry(on, w)
  installUi(on, w)
  installEngram(on, w)
  installClassic(on)
  if (!NATIVE_STATE) installFakeState(on)
  return w
}

/** An inspectable `$.store` (tests read and seed `w.store`). */
function installStore(on: On, w: World): void {
  on('store.get', (_$, e) => ({ value: w.store.get(e.key) }))
  on('store.set', (_$, e) => {
    w.store.set(e.key, JSON.parse(JSON.stringify(e.value)) as unknown)
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    w.store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...w.store.keys()] }))
}

function installSession(on: On, w: World): void {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: ROOT }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.messages', () => ({ value: [] }))
  on('session.append', (_$, e) => {
    w.appended.push(e.message.content.map(block => (typeof block.text === 'string' ? block.text : '')).join(''))
    return { message: e.message, uuid: `u-${w.appended.length}` }
  })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
}

type Answer<T> = { readonly value: T } | { readonly deny: string }

const fsRead = (w: World, spelled: string): Answer<string> => {
  const text = w.files.get(realOf(w, absPath(spelled)))
  return text === undefined ? { deny: `ENOENT: no such file or directory, open '${spelled}'` } : { value: text }
}

const fsWrite = (w: World, spelled: string, text: string): Answer<undefined> => {
  const path = realOf(w, absPath(spelled))
  w.files.set(path, text)
  w.mtimes.set(path, w.clock.now())
  return { value: undefined }
}

const fsExists = (w: World, spelled: string): Answer<boolean> => {
  const path = realOf(w, absPath(spelled))
  return { value: w.files.has(path) || isDir(w, path) }
}

const fsStat = (w: World, spelled: string, resolve?: boolean): Answer<FsStat> => {
  const path = realOf(w, absPath(spelled))
  const text = w.files.get(path)
  const kind = text !== undefined ? 'file' as const : isDir(w, path) ? 'dir' as const : undefined
  if (kind === undefined) return { deny: `ENOENT: no such file or directory, stat '${spelled}'` }
  const stat = { kind, size: text?.length ?? 0, mtimeMs: w.mtimes.get(path) ?? 0, isLink: absPath(spelled) !== path }
  return { value: (resolve === true ? { ...stat, realPath: path } : stat) as FsStat }
}

const processRun = (w: World, argv: readonly string[]): Answer<ProcessRunResult> => {
  w.runs.push([...argv])
  const index = w.rules.findIndex(rule => rule.match(argv))
  const rule = w.rules[index]
  if (rule === undefined) return { deny: `world: unscripted command: ${argv.join(' ')}` }
  if (rule.once === true) w.rules.splice(index, 1)
  const answer = typeof rule.answer === 'function' ? rule.answer(argv) : rule.answer
  if (answer.reject !== undefined) return { deny: answer.reject }
  return {
    value: {
      exitCode: answer.exitCode ?? 0,
      stdout: answer.stdout ?? '',
      stderr: answer.stderr ?? '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    } as ProcessRunResult,
  }
}

function installFs(on: On, w: World): void {
  on('fs.read', (_$, e) => fsRead(w, e.path))
  on('fs.write', (_$, e) => fsWrite(w, e.path, e.text))
  on('fs.exists', (_$, e) => fsExists(w, e.path))
  on('fs.stat', (_$, e) => fsStat(w, e.path, e.resolve))
}

function installProcess(on: On, w: World): void {
  on('process.run', (_$, e) => processRun(w, e.argv))
}

/** Resolves an answer as the engine resolves a `$` call: a deny rejects. */
const settle = <T>(answer: Answer<T>): Promise<T> =>
  'deny' in answer ? Promise.reject(new Error(answer.deny)) : Promise.resolve(answer.value)

/** An `Io` answered by this world directly, as its hooks answer the plugin. */
export function worldIo(w: World): Io {
  return {
    fs: {
      read: path => settle(fsRead(w, path)),
      write: (path, text) => settle(fsWrite(w, path, text)),
      exists: path => settle(fsExists(w, path)),
      stat: (path, options) => settle(fsStat(w, path, options?.resolve)),
    },
    process: { run: argv => settle(processRun(w, argv)) },
  }
}

function installAgents(on: On, w: World): void {
  on('agent.spawn', (_$, e) => {
    if (w.spawnDeny !== undefined) return { deny: w.spawnDeny }
    const agentId = `agent-${w.spawns.length + 1}`
    w.spawns.push({ agentId, subagentType: e.subagentType, prompt: e.prompt, model: e.model })
    w.alive.add(agentId)
    return { model: e.model ?? 'inherit', agentId }
  })
  on('agent.offer', () => ({ isOffered: true }))
  on('agent.list', () => ({
    value: [...w.alive].map(id => ({ id, description: '', type: 'zboard', status: 'running' as const })),
  }))
  on('agent.register', (_$, e) => {
    w.agentSpecs.set(e.name, { ...e })
    return { value: { agent: `zboard:${e.name}` } }
  })
}

function installRegistry(on: On, w: World): void {
  on('command.register', (_$, e) => {
    w.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('tool.register', (_$, e) => {
    w.tools.push(e.name)
    return { value: { tool: `mcp__zboard__${e.name}` } }
  })
  on('tool.check', () => ({ decision: 'allow' as const }))
}

function installUi(on: On, w: World): void {
  on('ui.open', (_$, e) => {
    w.opened.push(e.id)
    return w.placePanes
      ? { value: { isPlaced: true as const } }
      : { value: { isPlaced: false as const, reason: 'unasked panes seat from 144 columns; the terminal is 100' } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.toast', (_$, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.notice', () => ({ value: undefined }))
}

function engramGate(w: World, tool: string): { isError: true; result: string; text: string } | undefined {
  if (w.engram === 'missing') throw new Error(`No such tool available: ${tool}`)
  return w.engram === 'error' ? { isError: true, result: 'engram unavailable', text: 'engram unavailable' } : undefined
}

function installEngram(on: On, w: World): void {
  on('tool.call', { tool: 'mcp__engram__mem_save' }, (_$, e) => {
    const failed = engramGate(w, e.tool)
    if (failed !== undefined) return failed
    const topic = String(e.topic_key ?? e.title ?? '')
    const index = w.saved.findIndex(saved => saved.topic === topic)
    const id = index >= 0 ? (w.saved[index]?.id ?? index + 1) : w.saved.length + 1
    const entry = { id, topic, content: String(e.content ?? '') }
    if (index >= 0) w.saved.splice(index, 1, entry)
    else w.saved.push(entry)
    return { result: `saved #${id}`, text: `Memory saved #${id}` }
  })
  on('tool.call', { tool: 'mcp__engram__mem_search' }, (_$, e) => {
    const failed = engramGate(w, e.tool)
    if (failed !== undefined) return failed
    const query = String(e.query ?? '')
    const hits = w.saved.filter(saved => saved.topic.includes(query) || saved.content.includes(query))
    const text = hits.length === 0
      ? 'No memories found.'
      : [`Found ${hits.length} memories:`, ...hits.map(hit => `#${hit.id} [architecture] ${hit.topic}`)].join('\n')
    return { result: text, text }
  })
  on('tool.call', { tool: 'mcp__engram__mem_get_observation' }, (_$, e) => {
    const failed = engramGate(w, e.tool)
    if (failed !== undefined) return failed
    const hit = w.saved.find(saved => saved.id === Number(e.id))
    if (hit === undefined) return { isError: true as const, result: 'not found', text: 'not found' }
    const text = `#${hit.id} ${hit.topic}\nTopic: ${hit.topic}\n\n${hit.content}`
    return { result: text, text }
  })
}

function installClassic(on: On): void {
  on('classic.SessionStart', () => ({}))
  on('classic.SubagentStart', () => ({}))
  on('classic.SubagentStop', () => ({}))
  on('classic.PreCompact', () => ({}))
  on('classic.PostCompact', () => ({}))
  on('classic.FileChanged', () => ({}))
}

type StateEvent = { plugin: string; key: string; id?: string; value?: unknown; ifVersion?: number }

function installFakeState(on: On): void {
  const held = new Map<string, { value: unknown; version: number }>()
  const keyOf = (e: StateEvent): string => `${e.plugin}/${e.key}/${e.id ?? ''}`
  on('state.get', (_$, e) => {
    const found = held.get(keyOf(e as unknown as StateEvent))
    return { value: found ?? { value: undefined, version: 0 } }
  })
  on('state.set', (_$, e) => {
    const write = e as unknown as StateEvent
    const current = held.get(keyOf(write))?.version ?? 0
    if (write.ifVersion !== undefined && write.ifVersion !== current) {
      return { value: { isSet: false as const, version: current } }
    }
    held.set(keyOf(write), { value: write.value, version: current + 1 })
    return { value: { isSet: true as const, version: current + 1 } }
  })
}

/** A complete `agent.spawn` input for the kit's engine (fields the engine stamps get neutral values). */
export const spawnInput = (prompt: string, subagentType: string): AgentSpawnInput =>
  ({ tool_use_id: 'test', prompt, description: subagentType, subagentType, provider: { plugin: 'test' }, parentModel: 'test', background: true }) as AgentSpawnInput
