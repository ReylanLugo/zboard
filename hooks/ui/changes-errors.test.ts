import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { READY_FILES, VALIDATE_UNKNOWN_JSON, scriptOpenspec, seedChange } from '../testing/openspec.ts'
import { SURFACES, findIn, mountPane } from '../testing/ui.ts'
import { argvIs, installWorld } from '../testing/world.ts'
import { boot, zboard } from '../testing/zboard.ts'

const CRASH = 'openspec: command crashed\n    at main (cli.js:1:1)'

for (const surface of SURFACES) {
  test(`${surface}: a list error reads as one line and o toggles its raw output`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    scriptOpenspec(w, { list: { exitCode: 1, stderr: CRASH } })
    await boot($)
    await zboard($, 'changes')
    const ui = await mountPane($, surface, 'zboard-changes')
    expect((await ui.find({ key: 'list-error' }))?.text).toBe('⚠ openspec: command crashed')
    expect((await ui.find({ key: 'changes-header' }))?.text).toContain('⚠ 1 issue')
    expect(await ui.find({ key: 'raw-list-error' })).toBeUndefined()
    expect(JSON.stringify(await ui.drawn())).not.toContain('cli.js')
    expect((await ui.find({ key: 'raw' }))?.props.hotkey).toBe('o')
    expect((await ui.find({ key: 'raw' }))?.props.label).toBe('[o] raw output')
    await ui.press({ key: 'raw' })
    expect((await findIn(ui, 'raw-list-error', 'Code'))?.props.source).toBe(CRASH)
    expect((await ui.find({ key: 'raw' }))?.props.label).toBe('[o] hide raw output')
    await ui.press({ key: 'raw' })
    expect(await ui.find({ key: 'raw-list-error' })).toBeUndefined()
    await ui.unmount()
  })

  test(`${surface}: a change's CLI status error reads as its message; o shows the JSON`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    w.rules.push({ match: argvIs('openspec', 'status', '--change', 'broken'), answer: { exitCode: 1, stdout: VALIDATE_UNKNOWN_JSON } })
    scriptOpenspec(w)
    seedChange(w, 'broken', { 'brainstorm.md': 'b' })
    await boot($)
    await zboard($, 'changes broken')
    const ui = await mountPane($, surface, 'zboard-changes')
    expect((await ui.find({ key: 'change-error' }))?.text).toBe("⚠ Unknown item 'no-such-change'. Did you mean: zboard-v1, zboard-changes-viewer?")
    expect(JSON.stringify(await ui.drawn())).not.toContain('unknown_item')
    await ui.press({ key: 'raw' })
    expect((await findIn(ui, 'raw-change-error', 'Code'))?.props.source).toBe(VALIDATE_UNKNOWN_JSON)
    await ui.unmount()
  })

  test(`${surface}: the change detail names the schema the change uses`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    scriptOpenspec(w)
    seedChange(w, 'a', READY_FILES)
    await boot($)
    await zboard($, 'changes a')
    const ui = await mountPane($, surface, 'zboard-changes')
    expect((await ui.find({ key: 'detail-schema' }))?.text).toBe('schema · superpowers-bridge')
    expect(await ui.find({ key: 'raw' })).toBeUndefined()
    await ui.unmount()
  })
}
