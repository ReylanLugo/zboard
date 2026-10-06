import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { READY_FILES, READY_SPEC, scriptOpenspec, seedChange } from '../testing/openspec.ts'
import { SURFACES, labelOf, mountPane } from '../testing/ui.ts'
import { installWorld } from '../testing/world.ts'
import type { PlanLog } from '../plan/plan-log.ts'
import { EMPTY_PLAN_LOG, appendPlanEvents } from '../plan/plan-log.ts'
import type { Finding } from '../plan/types.ts'
import { boot, json, lastAgent, stopAgent, zboard } from '../testing/zboard.ts'

const PLAN_KEY = { plugin: 'zboard', key: 'plan' } as const
const SPEC = `${READY_SPEC}\n### Requirement: Import CSV\nThe system SHALL import.\n\n#### Scenario: Import\n- **WHEN** x\n- **THEN** y\n`
const DONE = '## 1. Core\n\n- [x] 1.1 Export CSV writer [req: Export CSV]\n  Acceptance: a\n- [x] 1.2 Import CSV reader [req: Import CSV]\n  Acceptance: b\n'
const FOUR_GROUPS = [1, 2, 3, 4].map(n => `## ${n}. G${n}\n\n- [ ] ${n}.1 Export CSV part ${n} [req: Export CSV]\n  Acceptance: x\n`).join('\n')

for (const surface of SURFACES) {
  test(`${surface}: findings offer only their allowed resolutions`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    scriptOpenspec(w)
    seedChange(w, 'a', { ...READY_FILES, 'specs/export/spec.md': SPEC, 'tasks.md': DONE })
    await boot($)
    await zboard($, 'changes a')
    const ui = await mountPane($, surface, 'zboard-changes')
    await ui.press({ key: 'tab:verify' })
    expect((await ui.find({ key: 'verify-state' }))?.text).toBe('No verify run yet.')
    expect((await ui.find({ key: 'archive-reason' }))?.text).toBe('archive: no passed verify run')
    await ui.press({ key: 'archive' })
    expect(w.runs.filter(argv => argv[1] === 'archive')).toEqual([])
    await ui.press({ key: 'verify' })
    await stopAgent($, lastAgent(w), json({ findings: [{ requirement: 'Export CSV', verdict: 'false', evidence: ['src/export.ts:3'] }, { requirement: 'Import CSV', verdict: 'no_evidence' }] }))
    expect((await ui.find({ key: 'finding:r:export-csv' }))?.text).toContain('Export CSV · false')
    expect(await ui.find({ key: 'resolve:r:export-csv:fix_code' })).toBeDefined()
    expect(await ui.find({ key: 'resolve:r:export-csv:adjust_spec' })).toBeDefined()
    expect(await ui.find({ key: 'resolve:r:export-csv:accepted' })).toBeUndefined()
    expect(await ui.find({ key: 'resolve:r:import-csv:fix_code' })).toBeUndefined()
    await ui.press({ key: 'resolve:r:import-csv:accepted' })
    expect((await ui.find({ key: 'finding:r:import-csv' }))?.text).toContain('Import CSV · no_evidence → accepted')
    expect((await ui.find({ key: 'verify-state' }))?.text).toBe('verify run 1 · not passed')
    await ui.unmount()
  })

  test(`${surface}: the plan forecast spawns nothing until it is confirmed`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    scriptOpenspec(w)
    const { 'plan.md': _plan, ...withoutPlan } = READY_FILES
    seedChange(w, 'a', { ...withoutPlan, 'tasks.md': FOUR_GROUPS })
    await boot($)
    await zboard($, 'changes a')
    const ui = await mountPane($, surface, 'zboard-changes')
    await ui.press({ key: 'draft' })
    expect((await ui.find({ key: 'forecast-line:0' }))?.text).toBe('4 drafter run(s) · opus 5.5/high')
    expect((await ui.find({ key: 'forecast-line:1' }))?.text).toBe('no estimate (no earlier drafter runs recorded)')
    expect(w.spawns).toEqual([])
    await ui.press({ key: 'forecast-dismiss' })
    expect(await ui.find({ key: 'forecast' })).toBeUndefined()
    expect(w.spawns).toEqual([])
    await ui.press({ key: 'draft' })
    await ui.press({ key: 'forecast-confirm' })
    expect(w.spawns.map(spawn => spawn.subagentType)).toEqual(['zboard:drafter'])
    await ui.unmount()
  })

  test(`${surface}: a critique finding becomes a comment; a twice-failed agent offers Retry`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    scriptOpenspec(w)
    seedChange(w, 'a', READY_FILES)
    await boot($)
    await zboard($, 'changes a')
    const ui = await mountPane($, surface, 'zboard-changes')
    await ui.press({ key: 'critique' })
    await stopAgent($, lastAgent(w), json({ findings: [{ severity: 'high', artifact: 'design', issue: 'no rollback plan', suggestion: 'describe one' }] }))
    expect((await ui.find({ key: 'critique:0' }))?.text).toContain('high · design · no rollback plan')
    await ui.press({ key: 'critique-comment:0' })
    expect(w.spawns[1]?.subagentType).toBe('zboard:drafter')
    await stopAgent($, lastAgent(w), 'prose')
    await stopAgent($, lastAgent(w), 'more prose')
    expect(await labelOf(ui, 'retry')).toBe('retry drafter')
    await ui.press({ key: 'retry' })
    expect(w.spawns).toHaveLength(4)
    await ui.unmount()
  })
}

test('the verify tab draws a finding that arrived without an evidence array', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const broken = { id: 'r:export-csv', requirement: 'Export CSV', verdict: 'false' } as unknown as Finding
  let isArmed = false
  // Served straight from the engine's plan state, past the mirror's validation: the tab itself must survive it.
  on('state.get', async (_$, e, next) => {
    const held = await next(e)
    if (!isArmed || e.plugin !== PLAN_KEY.plugin || e.key !== PLAN_KEY.key) return held
    const current = (held.value as { value?: PlanLog }).value ?? EMPTY_PLAN_LOG
    const { log } = appendPlanEvents(current, [{ type: 'PlanRestored', changeId: 'a', revisions: [], verify: { runs: 1, passed: false, findings: [broken] } }], 1)
    return { ...held, value: { ...held.value, value: log } } as typeof held
  })
  scriptOpenspec(w)
  seedChange(w, 'a', { ...READY_FILES, 'specs/export/spec.md': SPEC, 'tasks.md': DONE })
  await boot($)
  await zboard($, 'changes a')
  isArmed = true
  const ui = await mountPane($, 'terminal', 'zboard-changes')
  await ui.press({ key: 'tab:verify' })
  expect((await ui.find({ key: 'verify-state' }))?.text).toBe('verify run 1 · not passed')
  expect((await ui.find({ key: 'finding:r:export-csv' }))?.text).toContain('no evidence')
  await ui.unmount()
})
