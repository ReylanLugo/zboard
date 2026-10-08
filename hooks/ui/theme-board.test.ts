import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { SURFACES, findIn, mountPane, textsIn } from '../testing/ui.ts'
import { installWorld } from '../testing/world.ts'
import { TWO_TASKS, boot, setupDemo, zboard } from '../testing/zboard.ts'
import { THEME, roleColor } from './theme.ts'

const RULER = /^├─ zboard · demo ─+ 0\/2 ░░░░░ ─┤  ◐ 1 running · 0 decisions · 0 tok · \[v\] Kanban$/

for (const surface of SURFACES) {
  test(`${surface}: the blueprint theme validates and the board keeps its own keyed elements`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    setupDemo(w, TWO_TASKS)
    await boot($)
    await zboard($, 'run demo/1.1')
    const ui = await mountPane($, surface)
    expect(await ui.drawn()).toMatchObject({ type: 'Box' })
    for (const key of ['header', 'toolbar', 'kanban', 'box:1.1', 'mark:1.1', 'card:1.1', 'card:1.2']) expect(await ui.find({ key })).toBeDefined()
    await ui.unmount()
  })

  test(`${surface}: the header is a blueprint dimension ruler with progress in moss`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    setupDemo(w, TWO_TASKS)
    await boot($)
    await zboard($, 'run demo/1.1')
    const ui = await mountPane($, surface)
    expect((await ui.find({ key: 'header' }))?.text).toMatch(RULER)
    const parts = await textsIn(ui, 'header')
    expect(parts[0]).toMatchObject({ text: '├─ ', props: { color: THEME.blueprint } })
    expect(parts.find(part => part.text === '░░░░░')?.props.color).toBe(THEME.steel)
    expect(parts.find(part => part.text === '◐ 1 running')?.props.color).toBe(THEME.signal)
    await ui.unmount()
  })

  test(`${surface}: cards have a steel border that turns blueprint when selected, and a status marker`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    setupDemo(w, TWO_TASKS)
    await boot($)
    await zboard($, 'run demo/1.1')
    const ui = await mountPane($, surface)
    expect((await ui.find({ key: 'box:1.2' }))?.props).toMatchObject({ borderStyle: 'round', borderColor: THEME.steel })
    expect((await findIn(ui, 'mark:1.1', 'Text'))?.props.color).toBe(THEME.signal)
    expect((await ui.find({ key: 'mark:1.1' }))?.text).toBe('▌')
    await ui.press({ key: 'card:1.2' })
    expect((await ui.find({ key: 'box:1.2' }))?.props).toMatchObject({ borderStyle: 'bold', borderColor: THEME.blueprint })
    expect((await ui.find({ key: 'box:1.1' }))?.props.borderColor).toBe(THEME.steel)
    const chip = (await textsIn(ui, 'box:1.1')).find(part => part.text.includes('zboard:researcher'))
    expect(chip?.props.color).toBe(roleColor('researcher'))
    await ui.unmount()
  })

  test(`${surface}: Kanban column headers carry their status color and count`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    setupDemo(w, TWO_TASKS)
    await boot($)
    await zboard($, 'run demo/1.1')
    const ui = await mountPane($, surface)
    const colorOf = async (text: string) => (await ui.find({ type: 'Text', text }))?.props.color
    expect(await colorOf('Running (1)')).toBe(THEME.signal)
    expect(await colorOf('Review (0)')).toBe(THEME.signal)
    expect(await colorOf('Decision (0)')).toBe(THEME.brick)
    expect(await colorOf('Done (0)')).toBe(THEME.moss)
    expect(await colorOf('Ready (1)')).toBeUndefined()
    await ui.unmount()
  })

  test(`${surface}: Swimlanes color each lane by role and each chip by heartbeat; Tree sections are blueprint`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    setupDemo(w, TWO_TASKS)
    await boot($)
    await zboard($, 'run demo/1.1')
    const ui = await mountPane($, surface)
    await ui.press({ key: 'view' })
    const lane = await textsIn(ui, 'lane:researcher')
    expect(lane[0]).toMatchObject({ text: 'zboard:researcher (1)', props: { color: roleColor('researcher') } })
    expect(lane.find(part => part.text.includes('sonnet 5.5'))?.props.color).toBe(THEME.moss)
    await ui.press({ key: 'view' })
    expect((await ui.find({ type: 'Text', text: /^▾ / }))?.props.color).toBe(THEME.blueprint)
    expect((await findIn(ui, 'row:1.1', 'Text'))?.props.color).toBe(THEME.signal)
    await ui.unmount()
  })
}
