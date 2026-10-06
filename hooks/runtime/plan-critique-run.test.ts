import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { READY_FILES, READY_TASKS, scriptOpenspec, seedChange } from '../testing/openspec.ts'
import type { World } from '../testing/world.ts'
import { installWorld, worldIo } from '../testing/world.ts'
import { json, lastAgent, scriptGit } from '../testing/zboard.ts'
import type { Io } from './io.ts'
import { refreshChange } from './plan-catalog.ts'
import { critiqueChange, findingToComment } from './plan-critique.ts'
import { installPlanJobs } from './plan-jobs.ts'
import { runChange } from './plan-run.ts'
import { planStop } from './plan-runner.ts'
import { readPlan } from './plan-store.ts'

const ctx = { options: {} }

async function change(w: World, files: Readonly<Record<string, string>> = READY_FILES): Promise<Io> {
  installPlanJobs()
  scriptOpenspec(w)
  scriptGit(w)
  seedChange(w, 'a', files)
  const io = worldIo(w)
  await refreshChange(io, 'a')
  return io
}

test('a critique finding becomes a comment that drafts its artifact with the finding as data', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const io = await change(w)
  await critiqueChange(io, ctx, 'a')
  expect(w.spawns[0]?.subagentType).toBe('zboard:critic')
  await planStop(io, ctx, { agentId: lastAgent(w), answer: json({ findings: [{ severity: 'high', artifact: 'design', issue: 'no rollback plan', suggestion: 'describe one' }] }) })
  expect((await readPlan(io)).changes.a?.critique).toEqual([{ severity: 'high', artifact: 'design', issue: 'no rollback plan', suggestion: 'describe one' }])
  expect(await findingToComment(io, ctx, 'a', 0)).toBe(true)
  expect(w.spawns[1]?.subagentType).toBe('zboard:drafter')
  expect(w.spawns[1]?.prompt).toContain('Draft the artifact "design"')
  expect(w.spawns[1]?.prompt).toContain('<zboard-data label="user note" trust="untrusted">\nCritique (high): no rollback plan\nSuggestion: describe one\n</zboard-data>')
})

test('Run refuses while readiness fails and names the failing checks', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const io = await change(w, { ...READY_FILES, 'tasks.md': `${READY_TASKS}- [ ] 1.2 Polish\n  Acceptance: x\n` })
  expect(await runChange(io, ctx, 'a')).toBe('zboard: not ready to run a — readiness: coverage')
  expect(w.toasts).toEqual(['zboard: not ready to run a — readiness: coverage'])
  expect(w.spawns).toEqual([])
  expect(w.opened).toEqual([])
})

test('with green readiness and no critique, Run starts the board exactly as /zboard run does', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const io = await change(w)
  expect(await runChange(io, ctx, 'a')).toBe('zboard: running a')
  expect(w.opened).toEqual(['zboard'])
  expect(w.spawns.map(spawn => spawn.subagentType)).toEqual(['zboard:researcher'])
  expect((await readPlan(io)).changes.a?.stage).toBe('executing')
})

test('a run that /zboard run refuses toasts the refusal and keeps the change ready', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const io = await change(w)
  expect((await readPlan(io)).changes.a?.stage).toBe('ready')
  w.files.delete('/repo/openspec/changes/a/tasks.md')
  expect(await runChange(io, ctx, 'a')).toBe('zboard: no tasks.md for change a')
  expect(w.toasts.at(-1)).toBe('zboard: no tasks.md for change a')
  expect(w.spawns).toEqual([])
  const rec = (await readPlan(io)).changes.a
  expect(rec?.runStarted).toBe(false)
  expect(rec?.stage).toBe('ready')
})
