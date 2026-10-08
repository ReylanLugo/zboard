import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { OPENSPEC_TIMEOUT_MS } from '../adapters/openspec-cli.ts'
import { CONFIG_PATH, CONFIG_YAML, INIT_FAILED, scriptOpenspec, scriptUninitialized } from '../testing/openspec.ts'
import { SURFACES, findIn, labelOf, mountPane } from '../testing/ui.ts'
import { installWorld } from '../testing/world.ts'
import type { World } from '../testing/world.ts'
import { boot, zboard } from '../testing/zboard.ts'

const INIT = ['openspec', 'init', '--tools', 'none', '--no-animation']
const isInit = (argv: readonly string[]): boolean => argv[1] === 'init'
const initRuns = (w: World): string[][] => w.runs.filter(isInit)

for (const surface of SURFACES) {
  test(`${surface}: a folder without OpenSpec shows the init card and no raw CLI output`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    scriptUninitialized(w)
    scriptOpenspec(w)
    await boot($)
    expect(await zboard($, 'changes')).toBe('changes opened.')
    const ui = await mountPane($, surface, 'zboard-changes')
    expect((await ui.find({ key: 'changes-header' }))?.text).toBe('zboard changes · OpenSpec not initialized')
    expect((await ui.find({ key: 'init-title' }))?.text).toBe('◇  This folder has no OpenSpec project yet')
    expect((await ui.find({ key: 'init-why-1' }))?.text).toContain('proposal, design, specs and tasks')
    expect((await ui.find({ key: 'init-why-2' }))?.text).toContain('./openspec')
    expect(await labelOf(ui, 'init')).toBe('[i] Initialize OpenSpec here')
    expect((await ui.find({ key: 'init' }))?.props.hotkey).toBe('i')
    expect((await ui.find({ key: 'init-root' }))?.text).toBe('/repo')
    for (const key of ['init-why-1', 'init-why-2', 'init-root']) expect((await findIn(ui, key, 'Text'))?.props.dimColor).toBe(true)
    expect(await ui.find({ key: 'new' })).toBeUndefined()
    expect(await ui.find({ key: 'group:active' })).toBeUndefined()
    expect(await ui.find({ key: 'list-error' })).toBeUndefined()
    const drawn = JSON.stringify(await ui.drawn())
    for (const raw of ['no_openspec_root', 'severity', '"root"', 'openspec.root']) expect(drawn).not.toContain(raw)
    await ui.unmount()
  })

  test(`${surface}: i initializes OpenSpec at the root, switches to superpowers-bridge and refreshes`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    scriptUninitialized(w)
    scriptOpenspec(w)
    await boot($)
    await zboard($, 'changes')
    const ui = await mountPane($, surface, 'zboard-changes')
    const listsBefore = w.runs.filter(argv => argv[1] === 'list').length
    await ui.press({ key: 'init' })
    expect(initRuns(w)).toEqual([INIT])
    expect(w.runOptions[w.runs.findIndex(isInit)]).toEqual({ cwd: '/repo', timeoutMs: OPENSPEC_TIMEOUT_MS })
    expect(w.runs.slice(w.runs.findIndex(isInit)).filter(argv => argv[1] === 'list')).toHaveLength(1)
    expect(w.runs.filter(argv => argv[1] === 'list')).toHaveLength(listsBefore + 1)
    expect(w.files.get(CONFIG_PATH)).toBe(CONFIG_YAML.replace('schema: spec-driven', 'schema: superpowers-bridge'))
    expect(await ui.find({ key: 'init-title' })).toBeUndefined()
    expect((await ui.find({ key: 'changes-header' }))?.text).toBe('zboard changes · 0 active · 0 drafts · 0 archived')
    expect(await labelOf(ui, 'new')).toBe('[n] New change')
    await ui.unmount()
  })

  test(`${surface}: a failed init shows one readable line and keeps the card`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    scriptUninitialized(w, INIT_FAILED)
    scriptOpenspec(w)
    await boot($)
    await zboard($, 'changes')
    const ui = await mountPane($, surface, 'zboard-changes')
    await ui.press({ key: 'init' })
    expect((await ui.find({ key: 'init-error' }))?.text).toBe('⚠ OpenSpec init failed: Insufficient permissions to write to /repo')
    expect(await labelOf(ui, 'init')).toBe('[i] Initialize OpenSpec here')
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn.split('OpenSpec init failed')).toHaveLength(2)
    expect(drawn).not.toContain('Deferred global prompts')
    expect(drawn).not.toContain('EACCES')
    expect(w.files.has(CONFIG_PATH)).toBe(false)
    await ui.unmount()
  })

  test(`${surface}: an initialized folder without changes shows the new-change empty state`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    w.files.set(CONFIG_PATH, CONFIG_YAML)
    scriptOpenspec(w)
    await boot($)
    await zboard($, 'changes')
    const ui = await mountPane($, surface, 'zboard-changes')
    expect(await labelOf(ui, 'new')).toBe('[n] New change')
    expect((await ui.find({ key: 'new' }))?.props.hotkey).toBe('n')
    expect((await ui.find({ key: 'changes-none-hint' }))?.text).toContain('press n')
    expect((await findIn(ui, 'changes-none-hint', 'Text'))?.props.dimColor).toBe(true)
    expect(await ui.find({ key: 'group:active' })).toBeUndefined()
    expect(await ui.find({ key: 'init' })).toBeUndefined()
    await ui.unmount()
  })
}
