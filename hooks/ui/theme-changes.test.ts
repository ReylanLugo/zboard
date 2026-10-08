import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { READY_FILES, scriptOpenspec, scriptUninitialized, seedChange } from '../testing/openspec.ts'
import { SURFACES, findIn, mountPane, textsIn } from '../testing/ui.ts'
import { installWorld } from '../testing/world.ts'
import { boot, json, lastAgent, stopAgent, zboard } from '../testing/zboard.ts'
import { THEME, stageColor } from './theme.ts'

const DESIGN = 'openspec/changes/a/design.md'
const CRASH = 'openspec: command crashed\n    at main (cli.js:1:1)'

for (const surface of SURFACES) {
  test(`${surface}: the themed viewer validates, keeps its keyed elements and colors list icons by stage`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    scriptOpenspec(w)
    seedChange(w, 'a', READY_FILES)
    await boot($)
    await zboard($, 'changes a')
    const ui = await mountPane($, surface, 'zboard-changes')
    expect(await ui.drawn()).toMatchObject({ type: 'Box' })
    for (const key of ['changes-header', 'list', 'change:a', 'icon:a', 'detail', 'stepper', 'readiness', 'tabs']) expect(await ui.find({ key })).toBeDefined()
    expect(await findIn(ui, 'icon:a', 'Text')).toEqual({ props: { color: stageColor('ready') } })
    await ui.unmount()
  })

  test(`${surface}: the artifact stepper and the readiness bar are colored`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    scriptOpenspec(w)
    seedChange(w, 'a', { 'brainstorm.md': '# B\n', 'proposal.md': '## Why\n' })
    seedChange(w, 'b', { ...READY_FILES, 'tasks.md': `${READY_FILES['tasks.md'] ?? ''}- [ ] 1.2 Polish\n  Acceptance: x\n` })
    await boot($)
    await zboard($, 'changes a')
    const ui = await mountPane($, surface, 'zboard-changes')
    await ui.press({ key: 'draft' })
    const steps = await textsIn(ui, 'stepper')
    expect(steps.find(step => step.text.endsWith('● proposal'))?.props.color).toBe(THEME.moss)
    expect(steps.find(step => step.text.endsWith('◐ design'))?.props.color).toBe(THEME.blueprint)
    expect(steps.find(step => step.text.endsWith('○ tasks'))?.props.color).toBe(THEME.steel)
    await ui.press({ key: 'change:b' })
    expect((await findIn(ui, 'readiness', 'Text'))?.props.color).toBe(THEME.brick)
    expect((await findIn(ui, 'check:coverage', 'Text'))?.props.color).toBe(THEME.brick)
    await ui.unmount()
  })

  test(`${surface}: a passing readiness bar is moss`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    scriptOpenspec(w)
    seedChange(w, 'a', READY_FILES)
    await boot($)
    await zboard($, 'changes a')
    const ui = await mountPane($, surface, 'zboard-changes')
    expect((await findIn(ui, 'readiness', 'Text'))?.props.color).toBe(THEME.moss)
    await ui.unmount()
  })

  test(`${surface}: a list error is drawn in brick`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    scriptOpenspec(w, { list: { exitCode: 1, stderr: CRASH } })
    await boot($)
    await zboard($, 'changes')
    const ui = await mountPane($, surface, 'zboard-changes')
    expect((await findIn(ui, 'list-error', 'Text'))?.props.color).toBe(THEME.brick)
    await ui.unmount()
  })

  test(`${surface}: a proposal diff draws + lines moss, - lines brick and hunk headers blueprint in a bordered box`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    scriptOpenspec(w)
    seedChange(w, 'a', READY_FILES)
    await boot($)
    await zboard($, 'changes a')
    const ui = await mountPane($, surface, 'zboard-changes')
    await ui.press({ key: 'artifact:design' })
    await ui.press({ key: 'comment' })
    await ui.input({ key: 'compose', text: 'tighter' })
    await stopAgent($, lastAgent(w), json({ files: [{ path: DESIGN, content: '## Context\n\nA tight exporter.\n' }], notes: 'tightened' }))
    expect((await ui.find({ key: `diff-body:${DESIGN}` }))?.props).toMatchObject({ borderStyle: 'round', borderColor: THEME.steel })
    const lines = await textsIn(ui, `diff-body:${DESIGN}`)
    expect(lines.find(line => line.text === '+A tight exporter.')?.props.color).toBe(THEME.moss)
    expect(lines.find(line => line.text === '-A CSV exporter.')?.props.color).toBe(THEME.brick)
    expect(lines.find(line => line.text.startsWith('@@'))?.props.color).toBe(THEME.blueprint)
    expect(lines.find(line => line.text === ' ## Context')?.props.color).toBeUndefined()
    await ui.unmount()
  })

  test(`${surface}: the Initialize OpenSpec card has a blueprint border`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    scriptUninitialized(w)
    scriptOpenspec(w)
    await boot($)
    await zboard($, 'changes')
    const ui = await mountPane($, surface, 'zboard-changes')
    expect((await ui.find({ key: 'init-card' }))?.props).toMatchObject({ borderStyle: 'round', borderColor: THEME.blueprint })
    expect(await ui.find({ key: 'init' })).toBeDefined()
    await ui.unmount()
  })
}
