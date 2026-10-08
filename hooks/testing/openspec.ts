import { SCHEMA_ARTIFACTS } from './plan.ts'
import type { ProcessAnswer, World } from './world.ts'
import { ROOT, absPath, argvIs } from './world.ts'

/** Recorded with openspec 1.13.1 in /Volumes/Extern/zboard on 2026-10-06, trimmed to the fields zboard reads. */
export const LIST_JSON = JSON.stringify({
  changes: [
    { name: 'zboard-changes-viewer', completedTasks: 0, totalTasks: 0, lastModified: '2026-10-06T15:26:34.930Z', status: 'no-tasks' },
    { name: 'zboard-v1', completedTasks: 37, totalTasks: 37, lastModified: '2026-10-04T23:19:50.365Z', status: 'complete' },
  ],
  root: { path: '/Volumes/Extern/zboard', source: 'nearest' },
})

export const STATUS_JSON = JSON.stringify({
  changeName: 'zboard-changes-viewer',
  schemaName: 'superpowers-bridge',
  isPlanningComplete: false,
  isComplete: false,
  applyRequires: ['plan'],
  artifacts: [
    { id: 'brainstorm', outputPath: 'brainstorm.md', status: 'done', requires: [] },
    { id: 'proposal', outputPath: 'proposal.md', status: 'done', requires: ['brainstorm'] },
    { id: 'design', outputPath: 'design.md', status: 'done', requires: ['brainstorm'] },
    { id: 'specs', outputPath: 'specs/**/*.md', status: 'done', requires: ['proposal'] },
    { id: 'tasks', outputPath: 'tasks.md', status: 'ready', requires: ['specs'] },
    { id: 'plan', outputPath: 'plan.md', status: 'blocked', requires: ['tasks'], missingDeps: ['tasks'] },
    { id: 'verify', outputPath: 'verify.md', status: 'blocked', requires: ['plan'], missingDeps: ['plan'] },
    { id: 'retrospective', outputPath: 'retrospective.md', status: 'blocked', requires: ['verify'], missingDeps: ['verify'] },
  ],
  root: { path: '/Volumes/Extern/zboard', source: 'nearest' },
})

export const INSTRUCTIONS_TASKS_JSON = JSON.stringify({
  changeName: 'zboard-changes-viewer',
  artifactId: 'tasks',
  schemaName: 'superpowers-bridge',
  outputPath: 'tasks.md',
  existingOutputPaths: [],
  description: 'Implementation checklist with trackable tasks',
  instruction: 'Create the task list that breaks down the implementation work.\n\n**IMPORTANT: Follow the template below exactly.** The apply phase parses\ncheckbox format to track progress. Tasks not using `- [ ]` won\'t be tracked.\n',
  template: '## 1. <!-- Task Group Name -->\r\n\r\n- [ ] 1.1 <!-- Task description -->\r\n- [ ] 1.2 <!-- Task description -->\r\n',
  dependencies: [{ id: 'specs', done: true, path: 'specs/**/*.md', description: 'Detailed specifications for the change' }],
  unlocks: ['plan'],
})

export const VALIDATE_OK_JSON = JSON.stringify({
  items: [{ id: 'zboard-changes-viewer', type: 'change', valid: true, issues: [], durationMs: 33 }],
  summary: { totals: { items: 1, passed: 1, failed: 0 }, byType: { change: { items: 1, passed: 1, failed: 0 } } },
  version: '1.0',
  root: { path: '/Volumes/Extern/zboard', source: 'nearest' },
})

export const VALIDATE_UNKNOWN_JSON = JSON.stringify({
  status: [{ severity: 'error', code: 'unknown_item', message: "Unknown item 'no-such-change'. Did you mean: zboard-v1, zboard-changes-viewer?" }],
})

/** Shape from Step 1's spike (replace with the recorded output when it differs). */
export const validateInvalidJson = (id: string, issue: string): string => JSON.stringify({
  items: [{ id, type: 'change', valid: false, issues: [{ level: 'ERROR', path: 'specs/x/spec.md', message: issue }], durationMs: 5 }],
  version: '1.0',
})

/** The message openspec 1.13.1 `validate --strict --json` gives a change with no delta spec yet (exit 1). */
export const NO_DELTA_MESSAGE = 'Change must have at least one delta. No deltas found'

export const validateNoDeltaJson = (id: string): string => JSON.stringify({
  items: [{ id, type: 'change', valid: false, issues: [{ level: 'ERROR', path: '', message: NO_DELTA_MESSAGE }], durationMs: 5 }],
  version: '1.0',
})

/** Recorded with openspec 1.13.1 in a scratch repo on 2026-10-06, trimmed to the fields zboard reads. */
export const archiveOkJson = (id: string): string => JSON.stringify({
  archive: { change: id, archivedAs: `2026-10-06-${id}`, specsUpdated: true, totals: { added: 1, modified: 0, removed: 0, renamed: 0 } },
})

const CHANGES = `${ROOT}/openspec/changes`

export const READY_SPEC = '## ADDED Requirements\n\n### Requirement: Export CSV\nThe system SHALL export CSV.\n\n#### Scenario: Export\n- **WHEN** the user exports\n- **THEN** a CSV file is written\n'
export const READY_TASKS = '## 1. Core\n\n- [ ] 1.1 Write the CSV exporter [req: Export CSV]\n  Acceptance: a CSV file is written\n'

/** Every planning artifact of a change that passes readiness. */
export const READY_FILES: Readonly<Record<string, string>> = {
  'brainstorm.md': '# Brainstorm\n',
  'proposal.md': '## Why\n\nExport data.\n',
  'design.md': '## Context\n\nA CSV exporter.\n',
  'specs/export/spec.md': READY_SPEC,
  'tasks.md': READY_TASKS,
  'plan.md': '# Plan\n',
}

const optionOf = (argv: readonly string[], flag: string): string => argv[argv.indexOf(flag) + 1] ?? ''

/** Like the real CLI, `new change` without `--schema` uses the project default. */
const schemaOf = (argv: readonly string[]): string => (argv.includes('--schema') ? optionOf(argv, '--schema') : DEFAULT_SCHEMA)

const hasOutput = (w: World, id: string, path: string): boolean => {
  const dir = `${CHANGES}/${id}/`
  if (!path.includes('*')) return w.files.has(`${dir}${path}`)
  const prefix = `${dir}${path.slice(0, path.indexOf('*'))}`
  return [...w.files.keys()].some(key => key.startsWith(prefix) && key.endsWith('.md'))
}

const changeSchema = (w: World, id: string): string =>
  /^schema: (\S+)/m.exec(w.files.get(`${CHANGES}/${id}/.openspec.yaml`) ?? '')?.[1] ?? BRIDGE_SCHEMA

/** `openspec status --json` computed from the world's files, like the real CLI: done when the output exists. */
export function statusOf(w: World, id: string): Record<string, unknown> {
  const done = new Set(SCHEMA_ARTIFACTS.filter(([, path]) => hasOutput(w, id, path)).map(([artifact]) => artifact))
  return {
    changeName: id,
    schemaName: changeSchema(w, id),
    applyRequires: ['plan'],
    artifacts: SCHEMA_ARTIFACTS.map(([artifact, outputPath, requires]) => {
      const missing = requires.filter(dep => !done.has(dep))
      const status = done.has(artifact) ? 'done' : missing.length === 0 ? 'ready' : 'blocked'
      return { id: artifact, outputPath, status, requires, ...(status === 'blocked' ? { missingDeps: missing } : {}) }
    }),
  }
}

const changeNames = (w: World): string[] =>
  [...new Set([...w.files.keys()]
    .filter(key => key.startsWith(`${CHANGES}/`))
    .map(key => key.slice(CHANGES.length + 1).split('/')[0] ?? ''))]
    .filter(name => name !== '' && name !== 'archive')
    .sort()

function instructionsOf(w: World, artifact: string, id: string): Record<string, unknown> {
  const entry = SCHEMA_ARTIFACTS.find(([name]) => name === artifact)
  const status = statusOf(w, id).artifacts as { id: string; status: string }[]
  const done = new Set(status.filter(a => a.status === 'done').map(a => a.id))
  return {
    changeName: id,
    artifactId: artifact,
    schemaName: 'superpowers-bridge',
    outputPath: entry?.[1] ?? `${artifact}.md`,
    description: `${artifact} artifact`,
    instruction: `Write ${artifact}.`,
    template: `# ${artifact}\n`,
    dependencies: (entry?.[2] ?? []).map(dep => ({ id: dep, done: done.has(dep), path: SCHEMA_ARTIFACTS.find(([name]) => name === dep)?.[1] ?? '', description: '' })),
    unlocks: [],
  }
}

function archiveIn(w: World, id: string): ProcessAnswer {
  const from = `${CHANGES}/${id}/`
  const to = `${CHANGES}/archive/2026-10-06-${id}/`
  for (const key of [...w.files.keys()].filter(path => path.startsWith(from))) {
    w.files.set(`${to}${key.slice(from.length)}`, w.files.get(key) ?? '')
    w.files.delete(key)
  }
  return { stdout: archiveOkJson(id) }
}

const hasDeltaSpec = (w: World, id: string): boolean =>
  [...w.files.keys()].some(key => key.startsWith(`${CHANGES}/${id}/specs/`))

/** Like the real CLI, a change without any delta spec fails `--strict` validation before anything else. */
function validateIn(w: World, s: OpenspecScript, id: string): ProcessAnswer {
  if (!hasDeltaSpec(w, id)) return { exitCode: 1, stdout: validateNoDeltaJson(id) }
  return s.valid ? { stdout: VALIDATE_OK_JSON.replace('zboard-changes-viewer', id) } : { exitCode: 1, stdout: validateInvalidJson(id, s.issue) }
}

/** Mutable on purpose: a test flips `valid` or sets `archive` between steps. */
export interface OpenspecScript {
  valid: boolean
  issue: string
  list?: ProcessAnswer
  archive?: ProcessAnswer
  /** Names `openspec schemas --json` lists (spec-driven and superpowers-bridge when not given). */
  schemas?: readonly string[]
}

export function scriptOpenspec(w: World, script: Partial<OpenspecScript> = {}): OpenspecScript {
  const s: OpenspecScript = { valid: true, issue: 'Requirement must have at least one scenario', ...script }
  w.rules.push(
    { match: argvIs('openspec', 'list'), answer: () => s.list ?? { stdout: JSON.stringify({ changes: changeNames(w).map(name => ({ name, completedTasks: 0, totalTasks: 0, lastModified: '2026-10-06T00:00:00.000Z', status: 'in-progress' })) }) } },
    { match: argvIs('openspec', 'status'), answer: argv => ({ stdout: JSON.stringify(statusOf(w, optionOf(argv, '--change'))) }) },
    { match: argvIs('openspec', 'instructions'), answer: argv => ({ stdout: JSON.stringify(instructionsOf(w, argv[2] ?? '', optionOf(argv, '--change'))) }) },
    { match: argvIs('openspec', 'validate'), answer: argv => validateIn(w, s, argv[2] ?? '') },
    { match: argvIs('openspec', 'new', 'change'), answer: argv => { w.files.set(`${CHANGES}/${argv[3] ?? ''}/.openspec.yaml`, `schema: ${schemaOf(argv)}\n`); return {} } },
    { match: argvIs('openspec', 'schemas', '--json'), answer: () => ({ stdout: schemasJson(s.schemas ?? [DEFAULT_SCHEMA, BRIDGE_SCHEMA]) }) },
    { match: argvIs('openspec', 'archive'), answer: argv => s.archive ?? archiveIn(w, argv[2] ?? '') },
  )
  return s
}

export function seedChange(w: World, id: string, files: Readonly<Record<string, string>>): void {
  w.files.set(`${CHANGES}/${id}/.openspec.yaml`, 'schema: superpowers-bridge\n')
  for (const [path, text] of Object.entries(files)) w.files.set(`${CHANGES}/${id}/${path}`, text)
}

/** `rm -f -- <path>` as the artifact adapter runs it to undo a new file. */
export function scriptRm(w: World): void {
  w.rules.push({ match: argvIs('rm'), answer: argv => { w.files.delete(absPath(argv.at(-1) ?? '')); return {} } })
}

export const DEFAULT_SCHEMA = 'spec-driven'
export const BRIDGE_SCHEMA = 'superpowers-bridge'
export const CONFIG_PATH = `${ROOT}/openspec/config.yaml`

/** Recorded with openspec 1.13.1 (`openspec list --json`, exit 1) in a fresh `git init` scratch repo on 2026-10-08. */
export const NO_ROOT_LIST_JSON = JSON.stringify({
  changes: [],
  root: null,
  status: [{
    severity: 'error',
    code: 'no_openspec_root',
    message: 'No OpenSpec root found from the current directory.',
    target: 'openspec.root',
    fix: 'Run openspec init to create a root here.',
  }],
}, null, 2)

/** Recorded with openspec 1.13.1 (`openspec schemas --json`) on 2026-10-08, descriptions trimmed. */
export const schemasJson = (names: readonly string[]): string => JSON.stringify(names.map(name => ({
  name,
  description: name === BRIDGE_SCHEMA ? 'Spec-driven workflow integrated with Superpowers skills.' : 'Default OpenSpec workflow - proposal → specs → design → tasks',
  artifacts: name === BRIDGE_SCHEMA ? SCHEMA_ARTIFACTS.map(([id]) => id) : ['proposal', 'specs', 'design', 'tasks'],
  source: name === BRIDGE_SCHEMA ? 'user' : 'package',
})), null, 2)

/** The `openspec/config.yaml` that `openspec init --tools none` 1.13.1 writes (comment block trimmed). */
export const CONFIG_YAML = 'schema: spec-driven\n\n# Project context (optional)\n# This is shown to AI when creating artifacts.\n#   context: |\n#     Tech stack: TypeScript, React, Node.js\n\n# Per-artifact rules (optional)\n#   rules:\n#     proposal:\n#       - Keep proposals under 500 words\n'

/** stdout of a successful `openspec init --tools none --no-animation` (1.13.1), trimmed. */
export const INIT_OK_STDOUT = '- Creating OpenSpec structure...\n▌ OpenSpec structure created\n\nOpenSpec Setup Complete\n\nConfig: openspec/config.yaml (schema: spec-driven)\n'

/** A failed init (1.13.1, read-only folder, exit 1): unrelated notices on stdout, the error on stderr with colour codes. */
export const INIT_FAILED: ProcessAnswer = {
  exitCode: 1,
  stdout: 'Deferred global prompts cleanup\nThese global prompts will only be removed after matching replacement skills are installed.\n',
  stderr: `Insufficient permissions to write to ${ROOT}: EACCES: permission denied, open '${ROOT}/.openspec-test-1'\n\u001b[31m✖\u001b[39m Error: Insufficient permissions to write to ${ROOT}\n`,
}

/** Writes what a real init writes. */
function initIn(w: World): ProcessAnswer {
  w.files.set(CONFIG_PATH, CONFIG_YAML)
  w.files.set(`${CHANGES}/archive/.gitkeep`, '')
  w.files.set(`${ROOT}/openspec/specs/.gitkeep`, '')
  return { stdout: INIT_OK_STDOUT }
}

/**
 * A repository without OpenSpec: `list` answers the no-root status until `init` created
 * `openspec/config.yaml`. Push before `scriptOpenspec` so these rules win.
 */
export function scriptUninitialized(w: World, init?: ProcessAnswer): void {
  w.rules.push(
    { match: argvIs('openspec', 'list'), answer: () => (w.files.has(CONFIG_PATH) ? { stdout: JSON.stringify({ changes: [] }) } : { exitCode: 1, stdout: NO_ROOT_LIST_JSON }) },
    { match: argvIs('openspec', 'init'), answer: () => init ?? initIn(w) },
  )
}
