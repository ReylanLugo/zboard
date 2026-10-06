import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { forecastLines, forecastOf } from '../plan/forecast.ts'
import { isDone } from '../plan/lifecycle.ts'
import { READY_FILES, scriptOpenspec, scriptRm, seedChange } from '../testing/openspec.ts'
import type { World } from '../testing/world.ts'
import { installWorld, worldIo } from '../testing/world.ts'
import { json, lastAgent, scriptGit } from '../testing/zboard.ts'
import type { Io } from './io.ts'
import { draftNext } from './plan-actions.ts'
import { acceptProposal } from './plan-apply.ts'
import { refreshChange } from './plan-catalog.ts'
import { confirmForecast, dismissForecast } from './plan-forecast.ts'
import { installPlanJobs } from './plan-jobs.ts'
import { TOKENS_KEY, planStop } from './plan-runner.ts'
import { readPlan } from './plan-store.ts'

const ctx = { options: {} }
const FOUR_GROUPS = [1, 2, 3, 4].map(n => `## ${n}. G${n}\n\n- [ ] ${n}.1 Export CSV part ${n} [req: Export CSV]\n  Acceptance: x\n`).join('\n')

async function planNext(w: World): Promise<Io> {
  installPlanJobs()
  scriptOpenspec(w)
  scriptGit(w)
  scriptRm(w)
  const { 'plan.md': _plan, ...withoutPlan } = READY_FILES
  seedChange(w, 'a', { ...withoutPlan, 'tasks.md': FOUR_GROUPS })
  const io = worldIo(w)
  await refreshChange(io, 'a')
  return io
}

test('the forecast is group count times the average recorded drafter run', () => {
  const forecast = forecastOf('a', ['1. A', '2. B', '3. C', '4. D'], { model: 'opus 5.5', effort: 'high' }, [1_000, 3_000])
  expect(forecast.estimate).toEqual({ perRun: 2_000, low: 4_000, high: 12_000 })
  expect(forecastLines(forecast).slice(0, 2)).toEqual(['4 drafter run(s) · opus 5.5/high', '≈ 8000 tokens (4000–12000; 2000 per run)'])
  expect(forecastLines(forecastOf('a', ['1. A'], { model: 'opus 5.5' }, []))[1]).toBe('no estimate (no earlier drafter runs recorded)')
})

test('with plan next, draft next shows a forecast of one run per group and spawns nothing', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const io = await planNext(w)
  w.store.set(TOKENS_KEY, [1_000, 3_000])
  expect(await draftNext(io, ctx, 'a')).toBe(true)
  expect(w.spawns).toEqual([])
  expect((await io.state.ui.read()).changes.forecast).toEqual({
    changeId: 'a', groups: ['1. G1', '2. G2', '3. G3', '4. G4'], model: 'opus 5.5', effort: 'high', estimate: { perRun: 2_000, low: 4_000, high: 12_000 },
  })
})

test('dismissing the forecast spawns nothing and plan stays not done', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const io = await planNext(w)
  await draftNext(io, ctx, 'a')
  await dismissForecast(io)
  expect((await io.state.ui.read()).changes.forecast).toBeNull()
  expect(w.spawns).toEqual([])
  const rec = (await readPlan(io)).changes.a
  expect(rec === undefined ? true : isDone(rec, 'plan')).toBe(false)
})

test('confirming drafts group 1; group 2 is spawned only after group 1 is accepted', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const io = await planNext(w)
  await draftNext(io, ctx, 'a')
  expect(await confirmForecast(io, ctx)).toBe(true)
  expect(w.spawns).toHaveLength(1)
  expect(w.spawns[0]?.prompt).toContain('<zboard-data label="tasks.md group" trust="untrusted">\n1. G1\n</zboard-data>')
  await planStop(io, ctx, { agentId: lastAgent(w), answer: json({ files: [{ path: 'openspec/changes/a/plan.md', content: '# Plan\n\n### Task 1.1: Part 1\n\n**Acceptance:** x\n' }], notes: '' }) })
  expect(w.spawns).toHaveLength(1)
  await acceptProposal(io, ctx, 'a')
  expect(w.spawns).toHaveLength(2)
  expect(w.spawns[1]?.prompt).toContain('<zboard-data label="tasks.md group" trust="untrusted">\n2. G2\n</zboard-data>')
  expect((await readPlan(io)).changes.a?.planGroups).toEqual({ groups: ['1. G1', '2. G2', '3. G3', '4. G4'], next: 1 })
})
