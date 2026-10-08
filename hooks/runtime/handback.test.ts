import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { scriptOpenspec } from '../testing/openspec.ts'
import { mountPane } from '../testing/ui.ts'
import { HANDBACK_TOOL, installWorld, worldIo } from '../testing/world.ts'
import { ANSWERS, boot, json, lastAgent, scriptGit, setupDemo, stopAgent, stopAgentWithText, zboard } from '../testing/zboard.ts'
import { HANDBACK_CAP, handbackNote, stopAnswer, withHandback, withoutHandback } from './handback.ts'

const handBack = ($: Engine, agentId: string, message: string) =>
  $.tool.call({ tool: HANDBACK_TOOL, message, agentId } as never)

test('the stored hand-backs keep the newest entries up to the cap and drop an agent\'s once taken', () => {
  const many = Array.from({ length: HANDBACK_CAP + 3 }, (_, index) => ({ agentId: `a${index}`, message: `m${index}` }))
  const kept = many.reduce(withHandback, [] as readonly { agentId: string; message: string }[])
  expect(kept).toHaveLength(HANDBACK_CAP)
  expect(kept[0]?.agentId).toBe('a3')
  const replaced = withHandback(kept, { agentId: 'a5', message: 'again' })
  expect(replaced.filter(entry => entry.agentId === 'a5')).toEqual([{ agentId: 'a5', message: 'again' }])
  expect(withoutHandback(replaced, 'a5').some(entry => entry.agentId === 'a5')).toBe(false)
})

test('a pipeline agent\'s hand-back is kept by zboard and the main session gets a one-line note', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  await zboard($, 'run demo')
  await handBack($, lastAgent(w), ANSWERS.research)
  expect(w.handbacks).toEqual([{ agentId: 'agent-1', message: handbackNote('researcher', 'agent-1') }])
  expect(w.handbacks[0]?.message).toBe('zboard captured this report (researcher, agent agent-1); it is shown in the zboard pane.')
})

test('a plan agent\'s hand-back is kept by zboard and the main session gets a one-line note', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  scriptOpenspec(w)
  scriptGit(w)
  await boot($)
  await zboard($, 'changes')
  const ui = await mountPane($, 'terminal', 'zboard-changes')
  await ui.press({ key: 'new' })
  await ui.input({ key: 'compose', text: 'add-export' })
  await ui.press({ key: 'draft' })
  await handBack($, lastAgent(w), json({ question: 'CSV or TSV?', options: ['CSV', 'TSV'], why: 'format' }))
  expect(w.handbacks.map(entry => entry.message)).toEqual([handbackNote('brainstormer', lastAgent(w))])
})

test('a hand-back from an agent zboard does not run reaches the main session untouched', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  await zboard($, 'run demo')
  await handBack($, 'stranger', 'my own report')
  expect(w.handbacks).toEqual([{ agentId: 'stranger', message: 'my own report' }])
})

test('a stop takes the kept report once; final text wins but still drops it', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async (_$, on) => {
  const io = worldIo(installWorld(on))
  await io.state.handbacks.update(() => [{ agentId: 'a1', message: 'report one' }, { agentId: 'a2', message: 'report two' }])
  expect(await stopAnswer(io, 'a1', undefined)).toBe('report one')
  expect(await stopAnswer(io, 'a1', '  ')).toBeUndefined()
  expect(await stopAnswer(io, 'a2', 'final text')).toBe('final text')
  expect(await io.state.handbacks.read()).toEqual([])
})

test('a pipeline phase completes from the report its agent handed back', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  await zboard($, 'run demo')
  await stopAgent($, w, lastAgent(w), ANSWERS.research)
  expect(w.spawns.map(spawn => spawn.subagentType)).toEqual(['zboard:researcher', 'zboard:planner'])
})

test('a pipeline phase still completes from an agent\'s final text', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  await zboard($, 'run demo')
  await stopAgentWithText($, w, lastAgent(w), ANSWERS.research)
  expect(w.spawns.map(spawn => spawn.subagentType)).toEqual(['zboard:researcher', 'zboard:planner'])
})
