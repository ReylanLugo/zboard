import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { SURFACES, mountPane } from '../testing/ui.ts'
import { installWorld, worldIo } from '../testing/world.ts'
import { ANSWERS, RED, TWO_TASKS, boot, scriptPtest, setupDemo, stopAgent, zboard } from '../testing/zboard.ts'

for (const surface of SURFACES) {
  test(`${surface}: the stored view opens the board in Swimlanes with the same tasks`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    setupDemo(w)
    w.store.set('zboard/prefs', { view: 'swimlane', filter: { kind: 'none' } })
    await boot($)
    await zboard($, 'run demo')
    const ui = await mountPane($, surface)
    expect((await ui.find({ key: 'header' }))?.text).toMatch(/\[v\] Swimlanes$/)
    expect((await ui.find({ key: 'lane:researcher' }))?.text).toContain('zboard:researcher (1)')
    expect(await ui.find({ key: 'card:1.1' })).toBeDefined()
    await ui.unmount()
  })

  test(`${surface}: an agent idle for more than 5 minutes has an amber heartbeat`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    setupDemo(w)
    w.store.set('zboard/prefs', { view: 'swimlane', filter: { kind: 'none' } })
    await boot($)
    await zboard($, 'run demo')
    await w.clock.advance(300_001)
    const ui = await mountPane($, surface)
    expect(await ui.find({ text: /🟠/ })).toBeDefined()
    await ui.unmount()
  })

  test(`${surface}: a task waiting on another task's files shows its wait reason in the queue`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    setupDemo(w, TWO_TASKS)
    scriptPtest(w, [RED, RED])
    w.store.set('zboard/prefs', { view: 'swimlane', filter: { kind: 'none' } })
    await boot($)
    await zboard($, 'run demo')
    await stopAgent($, 'agent-1', ANSWERS.research)
    await stopAgent($, 'agent-2', ANSWERS.research)
    await stopAgent($, 'agent-3', ANSWERS.plan)
    await stopAgent($, 'agent-4', ANSWERS.plan)
    await stopAgent($, 'agent-5', ANSWERS.tdd)
    await stopAgent($, 'agent-6', ANSWERS.tdd)
    const ui = await mountPane($, surface)
    expect((await ui.find({ key: 'wait:1.2' }))?.text).toBe('⏸ 1.2 waits 1.1 for src/a.ts')
    await ui.unmount()
  })
}
