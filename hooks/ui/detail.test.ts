import { expect, test } from 'claude-code/testing'

import { project } from '../domain/project.ts'
import { evs, loaded, parsed } from '../testing/factories.ts'
import { SURFACES, mountPane } from '../testing/ui.ts'
import { installWorld, worldIo } from '../testing/world.ts'
import { ANSWERS, boot, callTool, lastAgent, setupDemo, stopAgent, zboard } from '../testing/zboard.ts'
import { detailSections } from './detail-model.ts'

test('detail sections list acceptance, phases with gates, the run timeline and comment delivery', () => {
  const board = project(evs([
    loaded(parsed('1.1', { description: 'Parse tasks\nkeeps CRLF' })),
    { type: 'PhaseStarted', taskId: '1.1', phase: 'research', attempt: 1, agentId: 'a1', agentType: 'zboard:researcher', role: 'researcher', model: 'claude-sonnet-5-5', effort: 'medium', baseline: {} },
    { type: 'AgentStopped', agentId: 'a1' },
    { type: 'PhaseCompleted', taskId: '1.1', phase: 'research', attempt: 1, gate: 'pass', summary: '1 evidenced finding(s)' },
    { type: 'CommentAdded', taskId: '1.1', comment: { id: 'c1', author: 'user', text: 'check reviewer notes' } },
    { type: 'CommentDelivered', taskId: '1.1', commentId: 'c1', to: 'zboard:reviewer' },
  ]))
  const task = board.tasks['1.1']
  if (task === undefined) throw new Error('missing task')
  expect(detailSections(task, 2_000)).toEqual([
    { title: 'Acceptance', lines: ['○ Parse tasks', '○ keeps CRLF'] },
    { title: 'Phases', lines: ['research #1 (loop 0): ✓ 1 evidenced finding(s)'] },
    { title: 'Runs', lines: ['🟢 zboard:researcher sonnet 5.5/medium · 0s · 0 tok · ok'] },
    { title: 'Comments', lines: ['user: check reviewer notes', '  delivered to zboard:reviewer'] },
  ])
})

for (const surface of SURFACES) {
  test(`${surface}: v twice shows the Tree with sections and tasks`, async ($, on) => {
    const w = installWorld(on)
    setupDemo(w)
    await boot($)
    await zboard($, 'run demo')
    const ui = await mountPane($, surface)
    await ui.press({ key: 'view' })
    await ui.press({ key: 'view' })
    expect((await ui.find({ key: 'header' }))?.text).toMatch(/\[v\] Tree$/)
    expect(await ui.find({ text: '▾ 1. Core' })).toBeDefined()
    expect(await ui.find({ key: 'card:1.1' })).toBeDefined()
    await ui.unmount()
  })

  test(`${surface}: enter on a card opens the detail with delivery status and a full artifact on a`, async ($, on) => {
    const w = installWorld(on)
    setupDemo(w)
    await boot($)
    await zboard($, 'run demo')
    await callTool($, 'board_comment', { taskId: '1.1', text: 'keep CRLF intact' })
    await stopAgent($, lastAgent(w), ANSWERS.research)
    const board = await mountPane($, surface)
    await board.press({ key: 'card:1.1' })
    expect(w.opened).toContain('zboard-detail')
    const detail = await mountPane($, surface, 'zboard-detail')
    expect((await detail.find({ key: 'detail-title' }))?.text).toBe('1.1 Parse tasks — running (plan)')
    expect(await detail.find({ text: 'research #1 (loop 0): ✓ 1 evidenced finding(s)' })).toBeDefined()
    expect(await detail.find({ text: '  delivered to zboard:planner' })).toBeDefined()
    await detail.press({ key: 'artifact' })
    expect((await detail.find({ key: 'artifact-text' }))?.text).toContain('the parser lives here')
    await detail.unmount()
    await board.unmount()
  })
}
