import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { READY_FILES, scriptOpenspec, seedChange } from '../testing/openspec.ts'
import { SURFACES, mountPane } from '../testing/ui.ts'
import { installWorld, worldIo } from '../testing/world.ts'
import { focusChange } from './ChangesPane.tsx'
import { boot, json, lastAgent, setupDemo, stopAgent, zboard } from '../testing/zboard.ts'

const hotkey = async (ui: Awaited<ReturnType<typeof mountPane>>, key: string) => (await ui.find({ key }))?.props.hotkey

for (const surface of SURFACES) {
  test(`${surface}: every viewer action has its key`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    scriptOpenspec(w)
    seedChange(w, 'a', READY_FILES)
    await boot($)
    await zboard($, 'changes a')
    const ui = await mountPane($, surface, 'zboard-changes')
    const keys = [['new', 'n'], ['comment', 'c'], ['draft', 'd'], ['explain', 'e'], ['critique', 'x'], ['run', 'r']]
    for (const [key, letter] of keys) expect(await hotkey(ui, key ?? '')).toBe(letter)
    await ui.press({ key: 'comment' })
    await ui.input({ key: 'compose', text: 'tighten' })
    await stopAgent($, lastAgent(w), json({ files: [{ path: 'openspec/changes/a/plan.md', content: '# Plan v2\n' }], notes: '' }))
    expect(await hotkey(ui, 'accept')).toBe('a')
    expect(await hotkey(ui, 'reject')).toBe('z')
    await ui.unmount()
  })

  test(`${surface}: r while not ready runs nothing and shows the failing checks`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    scriptOpenspec(w)
    seedChange(w, 'a', { ...READY_FILES, 'tasks.md': `${READY_FILES['tasks.md'] ?? ''}- [ ] 1.2 Polish\n  Acceptance: x\n` })
    await boot($)
    await zboard($, 'changes a')
    const ui = await mountPane($, surface, 'zboard-changes')
    await ui.press({ key: 'run' })
    expect(w.spawns).toEqual([])
    expect(w.opened).toEqual(['zboard-changes'])
    expect(w.toasts).toContain('zboard: not ready to run a — readiness: coverage')
    expect((await ui.find({ key: 'check:coverage' }))?.text).toBe('✗ coverage: 1.2 names no requirement')
    await ui.unmount()
  })

  test(`${surface}: o on the board opens the viewer on the board's change`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    setupDemo(w)
    scriptOpenspec(w)
    await boot($)
    await zboard($, 'run demo')
    const board = await mountPane($, surface)
    expect(await hotkey(board, 'changes')).toBe('o')
    await board.press({ key: 'changes' })
    await board.unmount()
    expect(w.opened).toEqual(['zboard', 'zboard-changes'])
    const ui = await mountPane($, surface, 'zboard-changes')
    expect((await ui.find({ key: 'detail-title' }))?.text).toMatch(/^demo · /)
    await ui.unmount()
  })
}

test('focus on a tab key switches the tab (unit fallback)', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const io = worldIo(w)
  await focusChange(io, 'zboard-changes', 'tab:specs')
  expect((await io.state.ui.read()).changes.tab).toBe('specs')
  await focusChange(io, 'zboard', 'tab:verify')
  expect((await io.state.ui.read()).changes.tab).toBe('specs')
})
