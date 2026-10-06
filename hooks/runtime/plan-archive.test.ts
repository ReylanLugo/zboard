import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { finding } from '../testing/plan.ts'
import { READY_FILES, scriptOpenspec, scriptRm, seedChange } from '../testing/openspec.ts'
import type { World } from '../testing/world.ts'
import { installWorld, worldIo } from '../testing/world.ts'
import { json, lastAgent, scriptGit } from '../testing/zboard.ts'
import type { Io } from './io.ts'
import { draftRetrospective, archiveChange } from './plan-archive.ts'
import { acceptProposal } from './plan-apply.ts'
import { refreshChange } from './plan-catalog.ts'
import { installPlanJobs } from './plan-jobs.ts'
import { planStop } from './plan-runner.ts'
import { appendPlan, readPlan } from './plan-store.ts'

const ctx = { options: {} }
const CHECKED = (READY_FILES['tasks.md'] ?? '').replace('- [ ]', '- [x]')
const archives = (w: World) => w.runs.filter(argv => argv[0] === 'openspec' && argv[1] === 'archive')

async function verified(w: World, extra: Readonly<Record<string, string>> = {}): Promise<{ io: Io; script: ReturnType<typeof scriptOpenspec> }> {
  installPlanJobs()
  const script = scriptOpenspec(w)
  scriptGit(w)
  scriptRm(w)
  seedChange(w, 'a', { ...READY_FILES, 'tasks.md': CHECKED, 'verify.md': '# Verify\n', ...extra })
  const io = worldIo(w)
  await refreshChange(io, 'a')
  return { io, script }
}

test('archive is blocked before a passed verify run and names it', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const { io } = await verified(w)
  expect(await archiveChange(io, 'a')).toBe(false)
  expect(w.toasts).toEqual(['zboard: archive is disabled — no passed verify run'])
  expect(archives(w)).toEqual([])
})

test('archive is blocked by a newly linked open task', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const { io } = await verified(w, { 'retrospective.md': '# Retro\n', 'tasks.md': `${CHECKED}- [ ] 1.2 Fix it [req: Export CSV]\n  Acceptance: x\n` })
  await appendPlan(io, [{ type: 'VerifyRecorded', changeId: 'a', scope: [], findings: [finding({ requirement: 'Export CSV', resolution: 'fix_code', linkedTask: '1.2' })] }])
  expect(await archiveChange(io, 'a')).toBe(false)
  expect(w.toasts).toEqual(['zboard: archive is disabled — linked task 1.2 is open'])
})

test('an accepted retrospective enables archive; archive runs once and lists the change under Archived', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const { io } = await verified(w)
  await appendPlan(io, [{ type: 'VerifyRecorded', changeId: 'a', scope: [], findings: [finding({ requirement: 'Export CSV' })] }])
  expect(await draftRetrospective(io, ctx, 'a')).toBe(true)
  await planStop(io, ctx, { agentId: lastAgent(w), answer: json({ files: [{ path: 'openspec/changes/a/retrospective.md', content: '# Retrospective\n' }], notes: '' }) })
  await acceptProposal(io, ctx, 'a')
  expect(w.runs).toContainEqual(['git', 'commit', '--only', '-m', 'docs(a): retrospective rev 1', '--', 'openspec/changes/a/retrospective.md'])
  expect((await readPlan(io)).changes.a?.retrospectiveAccepted).toBe(true)
  expect(await archiveChange(io, 'a')).toBe(true)
  expect(archives(w)).toEqual([['openspec', 'archive', 'a', '--yes', '--json']])
  const board = await readPlan(io)
  expect(board.changes.a?.archived).toBe(true)
  expect(board.changes['2026-10-06-a']?.stage).toBe('archived')
})

test('a failed archive keeps the change, shows the CLI output and returns to retrospective', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const { io, script } = await verified(w, { 'retrospective.md': '# Retro\n' })
  await appendPlan(io, [{ type: 'VerifyRecorded', changeId: 'a', scope: [], findings: [finding({ requirement: 'Export CSV' })] }])
  script.archive = { exitCode: 1, stderr: 'delta conflict: requirement "Export CSV" already exists' }
  expect(await archiveChange(io, 'a')).toBe(false)
  const rec = (await readPlan(io)).changes.a
  expect(rec).toMatchObject({ archived: false, archiving: false, stage: 'retrospective' })
  expect(rec?.errors.at(-1)).toMatchObject({ hook: 'archive', message: 'delta conflict: requirement "Export CSV" already exists' })
  expect(w.toasts.at(-1)).toBe('zboard: openspec archive failed: delta conflict: requirement "Export CSV" already exists')
})

test('an invalid name is never archived', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const io = worldIo(w)
  expect(await archiveChange(io, '../x')).toBe(false)
  expect(w.toasts).toEqual(['zboard: invalid change name: ../x'])
  expect(w.runs).toEqual([])
})
