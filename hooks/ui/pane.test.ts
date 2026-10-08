import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { SURFACES, labelOf, mountPane } from '../testing/ui.ts'
import { installWorld, worldIo } from '../testing/world.ts'
import { TWO_TASKS, boot, lastAgent, setupDemo, stopAgent, taskOf, zboard } from '../testing/zboard.ts'

for (const surface of SURFACES) {
  test(`${surface}: with no change loaded the board hints at /zboard run`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    installWorld(on)
    await boot($)
    const ui = await mountPane($, surface)
    expect((await ui.find({ key: 'empty' }))?.text).toBe('No change loaded. Run /zboard run <change> to start.')
    await ui.unmount()
  })

  test(`${surface}: the header and Kanban columns render the running change`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    setupDemo(w)
    await boot($)
    await zboard($, 'run demo')
    const ui = await mountPane($, surface)
    expect((await ui.find({ key: 'header' }))?.text).toMatch(/^├─ zboard · demo ─+ 0\/1 ░░░░░ ─┤  ◐ 1 running · 0 decisions · 0 tok · \[v\] Kanban$/)
    expect(await ui.find({ text: 'Running (1)' })).toBeDefined()
    expect(await labelOf(ui, 'card:1.1')).toBe('1.1 Parse tasks')
    expect(await ui.find({ text: /zboard:researcher sonnet 5\.5\/medium/ })).toBeDefined()
    await ui.unmount()
  })

  test(`${surface}: c then text records a comment; an empty comment records nothing`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    setupDemo(w)
    await boot($)
    await zboard($, 'run demo')
    const ui = await mountPane($, surface)
    await ui.press({ key: 'card:1.1' })
    await ui.press({ key: 'comment' })
    await ui.input({ key: 'comment-input', text: 'use the cache' })
    await ui.press({ key: 'comment' })
    await ui.input({ key: 'comment-input', text: '   ' })
    expect((await taskOf($, '1.1')).comments.map(comment => [comment.author, comment.text])).toEqual([['user', 'use the cache']])
    await ui.unmount()
  })

  test(`${surface}: b blocks a ready task and the scheduler does not start it`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    setupDemo(w, TWO_TASKS)
    await boot($)
    await zboard($, 'run demo/1.2')
    const ui = await mountPane($, surface)
    await ui.press({ key: 'card:1.1' })
    await ui.press({ key: 'block' })
    expect((await taskOf($, '1.1')).status).toBe('blocked')
    await zboard($, 'run demo')
    expect(w.spawns.filter(spawn => spawn.prompt.startsWith('Task 1.1:'))).toEqual([])
    await ui.unmount()
  })

  test(`${surface}: p raises the selected task's priority`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    setupDemo(w, TWO_TASKS)
    await boot($)
    await zboard($, 'run demo/1.2')
    const ui = await mountPane($, surface)
    await ui.press({ key: 'card:1.1' })
    await ui.press({ key: 'priority' })
    expect((await taskOf($, '1.1')).priority).toBe(1)
    await ui.unmount()
  })

  test(`${surface}: f filters by status and shows only tasks needing a decision`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    setupDemo(w, TWO_TASKS)
    await boot($)
    await zboard($, 'run demo/1.1')
    await stopAgent($, lastAgent(w))
    await stopAgent($, lastAgent(w))
    const ui = await mountPane($, surface)
    for (let presses = 0; presses < 20 && (await labelOf(ui, 'filter')) !== 'filter: status: needs_decision'; presses += 1) {
      await ui.press({ key: 'filter' })
    }
    expect(await labelOf(ui, 'filter')).toBe('filter: status: needs_decision')
    expect(await ui.find({ key: 'card:1.1' })).toBeDefined()
    expect(await ui.find({ key: 'card:1.2' })).toBeUndefined()
    await ui.unmount()
  })

  test(`${surface}: v switches the view and stores it as a preference`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    setupDemo(w)
    await boot($)
    await zboard($, 'run demo')
    const ui = await mountPane($, surface)
    await ui.press({ key: 'view' })
    expect((await ui.find({ key: 'header' }))?.text).toMatch(/\[v\] Swimlanes$/)
    expect(w.store.get('zboard/prefs')).toEqual({ view: 'swimlane', filter: { kind: 'none' } })
    await ui.unmount()
  })
}
