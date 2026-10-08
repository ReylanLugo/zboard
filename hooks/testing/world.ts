import { mock } from 'claude-code/testing'
import type { AgentInfo, AgentSpawnInput, AgentSpawnResult, FsEntry, FsStat, On, ProcessRunResult, SessionMessagesResult, ToolCallResult } from 'claude-code'
import type { MockClock } from 'claude-code/testing'

import { EMPTY_LOG } from '../domain/log.ts'
import { EMPTY_PLAN_LOG } from '../plan/plan-log.ts'
import type { Io, StatePort } from '../runtime/io.ts'
import { DEFAULT_UI } from '../runtime/ui-types.ts'
import { NATIVE_STATE } from './harness-facts.ts'

export const ROOT = '/repo'
export const NOW = 1_000_000
const SETTLE_TURNS = 200

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
  /** The cwd and timeout each process run asked for, in `runs` order. */
  readonly runOptions: { readonly cwd?: string; readonly timeoutMs?: number }[]
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
  readonly memory: Map<string, unknown>
  readonly debug: string[]
  readonly clock: MockClock
  readonly timers: IoTimer[]
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
  const timers: IoTimer[] = []
  const w: World = {
    files: new Map(),
    mtimes: new Map(),
    links: new Map(),
    rules: [],
    runs: [],
    runOptions: [],
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
    memory: new Map(),
    debug: [],
    clock: ioClock(on, timers),
    timers,
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
  // The engine keeps a session row only through next(e); answering without it is refused.
  on('session.append', (_$, e, next) => {
    w.appended.push(e.message.content.map(block => (typeof block.text === 'string' ? block.text : '')).join(''))
    return next(e)
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

const fsList = (w: World, spelled: string): Answer<FsEntry[]> => {
  const dir = realOf(w, absPath(spelled))
  if (!isDir(w, dir)) return { deny: `ENOENT: no such file or directory, scandir '${spelled}'` }
  const kinds = new Map<string, 'file' | 'dir'>()
  for (const key of w.files.keys()) {
    if (!key.startsWith(`${dir}/`)) continue
    const rest = key.slice(dir.length + 1)
    const cut = rest.indexOf('/')
    kinds.set(cut < 0 ? rest : rest.slice(0, cut), cut < 0 ? 'file' : 'dir')
  }
  const names = [...kinds.keys()].sort()
  return {
    value: names.map(name => {
      const kind = kinds.get(name) ?? 'file'
      return { name, kind, size: kind === 'file' ? (w.files.get(`${dir}/${name}`)?.length ?? 0) : 0, mtimeMs: 0, isLink: false }
    }),
  }
}

const processRun = (w: World, argv: readonly string[], init?: { readonly cwd?: string; readonly timeoutMs?: number }): Answer<ProcessRunResult> => {
  w.runs.push([...argv])
  w.runOptions.push({
    ...(init?.cwd === undefined ? {} : { cwd: init.cwd }),
    ...(init?.timeoutMs === undefined ? {} : { timeoutMs: init.timeoutMs }),
  })
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
  on('fs.list', (_$, e) => fsList(w, e.path))
}

function installProcess(on: On, w: World): void {
  on('process.run', (_$, e) => processRun(w, e.argv, e.init))
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
      list: path => settle(fsList(w, path)),
    },
    process: { run: (argv, init) => settle(processRun(w, argv, init)) },
    agent: {
      register: async spec => agentRegister(w, spec) as Awaited<ReturnType<Io['agent']['register']>>,
      spawn: async input => agentSpawn(w, input),
      list: async () => agentList(w),
    },
    tool: {
      call: input => settle(engramAnswer(w, input.tool, input)),
      register: async spec => {
        w.tools.push(spec.name)
        return { tool: `mcp__zboard__${spec.name}` } as Awaited<ReturnType<Io['tool']['register']>>
      },
    },
    clock: {
      now: async () => w.clock.now(),
      after: (ms, fn) => {
        const timer: IoTimer = { due: w.clock.now() + ms, fn, isCancelled: false }
        w.timers.push(timer)
        return { cancel: () => { timer.isCancelled = true } }
      },
      every: (ms, fn) => {
        let current: IoTimer | undefined
        const arm = (): void => {
          current = { due: w.clock.now() + ms, fn: () => { arm(); fn() }, isCancelled: false }
          w.timers.push(current)
        }
        arm()
        return { cancel: () => { if (current !== undefined) current.isCancelled = true } }
      },
    },
    state: {
      log: memoryPort(w, 'log', EMPTY_LOG),
      ui: memoryPort(w, 'ui', DEFAULT_UI),
      artifacts: memoryPort<Readonly<Record<string, string>>>(w, 'artifacts', {}),
      plan: memoryPort(w, 'plan', EMPTY_PLAN_LOG),
    },
    store: {
      get: async key => w.store.get(key),
      set: async (key, value) => { w.store.set(key, JSON.parse(JSON.stringify(value)) as unknown) },
    },
    command: {
      register: async spec => {
        w.commands.push(spec.name)
        return { command: spec.name } as Awaited<ReturnType<Io['command']['register']>>
      },
    },
    session: {
      root: async () => ROOT,
      messages: async () => [] as unknown as SessionMessagesResult,
      append: async args => {
        w.appended.push(args.message.content.map(block => (typeof block.text === 'string' ? block.text : '')).join(''))
        return { message: args.message, uuid: `u-` } as unknown as Awaited<ReturnType<Io['session']['append']>>
      },
    },
    ui: {
      open: async pane => paneOpen(w, pane.id) as Awaited<ReturnType<Io['ui']['open']>>,
      close: async () => undefined as Awaited<ReturnType<Io['ui']['close']>>,
      toast: text => { w.toasts.push(text) },
      invalidate: () => undefined,
      debug: text => { w.debug.push(text) },
    },
  }
}

/** An in-memory `$.state` value kept on the world (`w.memory`), shared by every `worldIo(w)`. */
function memoryPort<T>(w: World, key: string, initial: T): StatePort<T> {
  return {
    read: async () => (w.memory.has(key) ? (w.memory.get(key) as T) : initial),
    update: async fn => {
      const next = fn(w.memory.has(key) ? (w.memory.get(key) as T) : initial)
      w.memory.set(key, next)
      return next
    },
  }
}

const engramAnswer = (w: World, tool: string, input: Record<string, unknown>): Answer<ToolCallResult> => {
  try {
    return { value: engramCall(w, tool, input) as unknown as ToolCallResult }
  } catch (error) {
    return { deny: error instanceof Error ? error.message : String(error) }
  }
}

/** A timer set through `worldIo`; fired by the world clock once its time comes. */
export interface IoTimer {
  readonly due: number
  readonly fn: () => void
  isCancelled: boolean
}

/** The kit's mock clock, whose moves also fire the timers set through `worldIo`. */
function ioClock(on: On, timers: IoTimer[]): MockClock {
  const base = mock.clock(on, { now: NOW })
  const fire = async (): Promise<void> => {
    const due = timers.filter(timer => !timer.isCancelled && timer.due <= base.now()).sort((a, b) => a.due - b.due)
    for (const timer of due) timer.isCancelled = true
    await Promise.all(due.map(timer => Promise.resolve(timer.fn() as unknown)))
    // Timer callbacks start async work without returning it; let that work settle.
    for (let turn = 0; turn < SETTLE_TURNS; turn++) await Promise.resolve()
  }
  return {
    ...base,
    advance: async ms => { await base.advance(ms); await fire() },
    set: async ms => { await base.set(ms); await fire() },
    sleep: async ms => { await base.sleep(ms); await fire() },
  }
}

/** The kit hands the hook beneath the Agent tool's raw parameters (`subagent_type`); direct test calls use `subagentType`. */
type SpawnArgs = { readonly prompt: string; readonly subagentType?: string; readonly subagent_type?: string; readonly model?: string }

/** The only values the Agent tool's `model` parameter accepts; a full id fails its input validation. */
export const AGENT_TOOL_MODELS: readonly string[] = ['sonnet', 'opus', 'haiku', 'fable']

/** The engine's answer to an Agent call whose `model` is not one of the tool's enum values (its issues pretty-printed, as live). */
export const modelValidationError = (model: string): string =>
  `<tool_use_error>InputValidationError: ${JSON.stringify([{
    code: 'invalid_enum_value',
    path: ['model'],
    message: `Invalid enum value. Expected ${AGENT_TOOL_MODELS.map(alias => `'${alias}'`).join(' | ')}, received '${model}'`,
  }], null, 2)}</tool_use_error>`

/** Without a `model` argument the agent runs on its registered definition's model. */
const definitionModel = (w: World, subagentType: string): string | undefined => {
  const model = w.agentSpecs.get(subagentType.slice(subagentType.indexOf(':') + 1))?.model
  return typeof model === 'string' ? model : undefined
}

const agentSpawn = (w: World, e: SpawnArgs): AgentSpawnResult => {
  if (w.spawnDeny !== undefined) return { deny: w.spawnDeny } as AgentSpawnResult
  if (e.model !== undefined && !AGENT_TOOL_MODELS.includes(e.model)) return { deny: modelValidationError(e.model) } as AgentSpawnResult
  const agentId = `agent-${w.spawns.length + 1}`
  const subagentType = e.subagentType ?? e.subagent_type ?? ''
  w.spawns.push({ agentId, subagentType, prompt: e.prompt, ...(e.model === undefined ? {} : { model: e.model }) })
  w.alive.add(agentId)
  return { model: e.model ?? definitionModel(w, subagentType) ?? 'inherit', agentId } as AgentSpawnResult
}

const agentList = (w: World): AgentInfo[] =>
  [...w.alive].map(id => ({ id, description: '', type: 'zboard', status: 'running' }) as AgentInfo)

const agentRegister = (w: World, spec: { readonly name: string }): { agent: string } => {
  w.agentSpecs.set(spec.name, { ...spec })
  return { agent: `zboard:${spec.name}` }
}

function installAgents(on: On, w: World): void {
  // Beneath a plugin's $.agent.spawn the kit runs the Agent tool, whose result carries the agent id.
  on('agent.spawn', (_$, e) => {
    const spawned = agentSpawn(w, e)
    return spawned.deny !== undefined ? spawned : ({ result: { agentId: spawned.agentId, resolvedModel: spawned.model }, model: spawned.model } as never)
  })
  on('agent.offer', () => ({ isOffered: true }))
  on('agent.list', () => ({ value: agentList(w) }))
  on('agent.register', (_$, e) => ({ value: agentRegister(w, e) }))
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
  on('ui.open', (_$, e) => ({ value: paneOpen(w, e.id) }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.toast', (_$, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', (_$, e) => {
    w.debug.push(String(e.text))
    return { value: undefined }
  })
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.notice', () => ({ value: undefined }))
}

function engramGate(w: World, tool: string): { isError: true; result: string; text: string } | undefined {
  if (w.engram === 'missing') throw new Error(`No such tool available: ${tool}`)
  return w.engram === 'error' ? { isError: true, result: 'engram unavailable', text: 'engram unavailable' } : undefined
}

type ToolAnswer = { isError?: true; result: string; text: string }
type Args = Record<string, unknown>

const engramSave = (w: World, e: Args): ToolAnswer => {
  const topic = String(e.topic_key ?? e.title ?? '')
  const index = w.saved.findIndex(saved => saved.topic === topic)
  const id = index >= 0 ? (w.saved[index]?.id ?? index + 1) : w.saved.length + 1
  const entry = { id, topic, content: String(e.content ?? '') }
  if (index >= 0) w.saved.splice(index, 1, entry)
  else w.saved.push(entry)
  return { result: `saved #${id}`, text: `Memory saved #${id}` }
}

const engramSearch = (w: World, e: Args): ToolAnswer => {
  const query = String(e.query ?? '')
  const hits = w.saved.filter(saved => saved.topic.includes(query) || saved.content.includes(query))
  const text = hits.length === 0
    ? 'No memories found.'
    : [`Found ${hits.length} memories:`, ...hits.map(hit => `#${hit.id} [architecture] ${hit.topic}`)].join('\n')
  return { result: text, text }
}

const engramGet = (w: World, e: Args): ToolAnswer => {
  const hit = w.saved.find(saved => saved.id === Number(e.id))
  if (hit === undefined) return { isError: true, result: 'not found', text: 'not found' }
  const text = `#${hit.id} ${hit.topic}\nTopic: ${hit.topic}\n\n${hit.content}`
  return { result: text, text }
}

const ENGRAM: Record<string, (w: World, e: Args) => ToolAnswer> = {
  mcp__engram__mem_save: engramSave,
  mcp__engram__mem_search: engramSearch,
  mcp__engram__mem_get_observation: engramGet,
}

/** Answers an Engram tool call as the world's hooks do; throws when Engram is missing. */
function engramCall(w: World, tool: string, e: Args): ToolAnswer {
  const failed = engramGate(w, tool)
  if (failed !== undefined) return failed
  const handler = ENGRAM[tool]
  if (handler === undefined) throw new Error(`world: unscripted tool: ${tool}`)
  return handler(w, e)
}

function installEngram(on: On, w: World): void {
  on('tool.call', { tool: 'mcp__engram__mem_save' }, (_$, e) => engramCall(w, e.tool, e))
  on('tool.call', { tool: 'mcp__engram__mem_search' }, (_$, e) => engramCall(w, e.tool, e))
  on('tool.call', { tool: 'mcp__engram__mem_get_observation' }, (_$, e) => engramCall(w, e.tool, e))
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

function paneOpen(w: World, id: string): { isPlaced: true } | { isPlaced: false; reason: string } {
  w.opened.push(id)
  return w.placePanes
    ? { isPlaced: true }
    : { isPlaced: false, reason: 'unasked panes seat from 144 columns; the terminal is 100' }
}
