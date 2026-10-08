import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { projectPlan } from '../plan/plan-project.ts'
import { READY_FILES, scriptOpenspec, seedChange } from '../testing/openspec.ts'
import { listing } from '../testing/plan.ts'
import { SURFACES, mountPane, rowOf } from '../testing/ui.ts'
import { argvIs, installWorld } from '../testing/world.ts'
import { boot, setupDemo, zboard } from '../testing/zboard.ts'
import { headerText } from './changes-model.ts'

for (const surface of SURFACES) {
  test(`${surface}: /zboard changes opens the viewer with Active, Drafts and Archived`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    scriptOpenspec(w)
    seedChange(w, 'a', READY_FILES)
    seedChange(w, 'b', { 'brainstorm.md': '# Brainstorm\n' })
    w.files.set('/repo/openspec/changes/archive/2026-01-01-c/proposal.md', 'p')
    await boot($)
    expect(await zboard($, 'changes')).toBe('changes opened.')
    expect(w.opened).toEqual(['zboard-changes'])
    const ui = await mountPane($, surface, 'zboard-changes')
    expect((await ui.find({ key: 'group:active' }))?.text).toBe('Active   (1)')
    expect((await ui.find({ key: 'group:drafts' }))?.text).toBe('Drafts   (1)')
    expect((await ui.find({ key: 'group:archived' }))?.text).toBe('Archived (1)')
    expect(await rowOf(ui, 'a')).toBe('● a · ready · ░░░░░ 0/1')
    expect(await rowOf(ui, 'b')).toBe('◐ b · authoring')
    expect(await rowOf(ui, '2026-01-01-c')).toBe('✓ 2026-01-01-c · archived')
    await ui.unmount()
  })

  test(`${surface}: /zboard changes <id> selects it; n and an id create a change`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    scriptOpenspec(w)
    seedChange(w, 'a', READY_FILES)
    await boot($)
    await zboard($, 'changes a')
    const ui = await mountPane($, surface, 'zboard-changes')
    expect((await ui.find({ key: 'detail-title' }))?.text).toBe('a · ready')
    await ui.press({ key: 'new' })
    await ui.input({ key: 'compose', text: 'add-export' })
    expect(w.runs).toContainEqual(['openspec', 'new', 'change', 'add-export', '--schema', 'superpowers-bridge'])
    expect(w.toasts).toContain('zboard: created add-export')
    expect(await rowOf(ui, 'add-export')).toBe('✎ add-export · draft')
    expect((await ui.find({ key: 'detail-title' }))?.text).toBe('add-export · draft')
    await ui.unmount()
  })

  test(`${surface}: a broken change shows its error; the others and the board still render`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    w.rules.push({ match: argvIs('openspec', 'status', '--change', 'broken'), answer: { exitCode: 1, stderr: 'boom' } })
    scriptOpenspec(w)
    seedChange(w, 'a', READY_FILES)
    seedChange(w, 'broken', { 'brainstorm.md': 'b' })
    await boot($)
    await zboard($, 'changes broken')
    const ui = await mountPane($, surface, 'zboard-changes')
    expect(await rowOf(ui, 'broken')).toBe('✎ broken · draft · ⚠ error')
    expect(await rowOf(ui, 'a')).toBe('● a · ready · ░░░░░ 0/1')
    expect((await ui.find({ key: 'change-error' }))?.text).toBe('⚠ boom')
    await ui.unmount()
    expect(await zboard($, '')).toBe('board opened.')
  })
}

test('the header counts the groups and shows the mirror and error state', () => {
  const plan = projectPlan([
    { type: 'ChangesListed', complete: true, changes: [listing('a'), listing('b', { archived: true })], seq: 1, at: 1 },
    { type: 'PlanMirrorState', pending: true, seq: 2, at: 2 },
    { type: 'PlanError', hook: 'new change', message: 'x', seq: 3, at: 3 },
  ])
  expect(headerText(plan)).toBe('zboard changes · 0 active · 1 drafts · 1 archived · ⚠ mirror pending · ⚠ 1 issue')
})

test('/zboard run behaves exactly as before; an invalid id is refused by /zboard changes', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  expect(await zboard($, 'run demo')).toBe('running demo')
  expect(w.opened).toEqual(['zboard'])
  expect(await zboard($, 'changes ../x')).toBe('invalid change name: ../x')
  expect(w.opened).toEqual(['zboard'])
})
