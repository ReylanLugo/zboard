import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { READY_FILES, scriptOpenspec, seedChange } from '../testing/openspec.ts'
import { SURFACES, labelOf, mountPane } from '../testing/ui.ts'
import { installWorld } from '../testing/world.ts'
import { boot, json, lastAgent, scriptGit, stopAgent, zboard } from '../testing/zboard.ts'

const TASKS = 'openspec/changes/a/tasks.md'
const BARE_TASKS = `## 1. Core\n\n${Array.from({ length: 5 }, (_, index) => `- [ ] 1.${index + 1} Task ${index + 1}\n`).join('')}`
const REPAIRED = `## 1. Core\n\n${Array.from({ length: 5 }, (_, index) => `- [ ] 1.${index + 1} Task ${index + 1} [req: Export CSV]\n  Acceptance: done ${index + 1}\n`).join('')}`

for (const surface of SURFACES) {
  test(`${surface}: repair tasks asks the drafter for req tags and acceptance, then shows a normal pending proposal`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    scriptOpenspec(w)
    scriptGit(w)
    seedChange(w, 'a', { ...READY_FILES, 'tasks.md': BARE_TASKS })
    await boot($)
    await zboard($, 'changes a')
    const ui = await mountPane($, surface, 'zboard-changes')
    expect((await ui.find({ key: 'check:acceptance' }))?.text).toBe('✗ acceptance: 5 tasks missing (1.1, 1.2, 1.3, …)')
    expect(await labelOf(ui, 'repair')).toBe('[k] repair tasks')
    await ui.press({ key: 'repair' })
    const spawn = w.spawns.at(-1)
    expect(spawn?.subagentType).toBe('zboard:drafter')
    expect(spawn?.prompt).toContain('- Export CSV')
    expect(spawn?.prompt).toContain('Acceptance:')
    expect(spawn?.prompt).toContain('[req: <Requirement name>]')
    expect(spawn?.prompt).toContain('no acceptance line: 1.1, 1.2, 1.3, 1.4, 1.5')
    await stopAgent($, w, lastAgent(w), json({ files: [{ path: TASKS, content: REPAIRED }], notes: 'tagged every task' }))
    expect((await ui.find({ key: 'accept' }))?.props.hotkey).toBe('a')
    expect((await ui.find({ key: 'reject' }))?.props.hotkey).toBe('z')
    await ui.unmount()
  })

  test(`${surface}: no repair button when tasks are fine, and none while an agent is running`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    scriptOpenspec(w)
    seedChange(w, 'a', READY_FILES)
    await boot($)
    await zboard($, 'changes a')
    const ui = await mountPane($, surface, 'zboard-changes')
    expect(await ui.find({ key: 'repair' })).toBeUndefined()
    await ui.unmount()
  })

  test(`${surface}: the repair button is withdrawn while an agent is running`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    scriptOpenspec(w)
    seedChange(w, 'a', { ...READY_FILES, 'tasks.md': BARE_TASKS })
    await boot($)
    await zboard($, 'changes a')
    const ui = await mountPane($, surface, 'zboard-changes')
    await ui.press({ key: 'repair' })
    expect(await ui.find({ key: 'repair' })).toBeUndefined()
    expect(w.spawns).toHaveLength(1)
    await ui.unmount()
  })
}
