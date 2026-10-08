import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { scriptOpenspec } from '../testing/openspec.ts'
import { mountPane } from '../testing/ui.ts'
import type { World } from '../testing/world.ts'
import { handbackRow, installWorld, worldIo } from '../testing/world.ts'
import { ANSWERS, boot, deliverPeer, json, lastAgent, scriptGit, setupDemo, stopAgent, stopAgentWithText, zboard } from '../testing/zboard.ts'
import { HANDBACK_CAP, stopAnswer, withHandback, withoutHandback } from './handback.ts'

/** The agent's run holds its SubagentHandback call; zboard never sees the call itself (re-entry). */
const handBack = (w: World, agentId: string, message: string): void => {
  w.transcripts.set(agentId, [...(w.transcripts.get(agentId) ?? []), handbackRow(message)])
}

test('the stored hand-backs keep the newest entries up to the cap and drop an agent\'s once taken', () => {
  const many = Array.from({ length: HANDBACK_CAP + 3 }, (_, index) => ({ agentId: `a${index}`, message: `m${index}` }))
  const kept = many.reduce(withHandback, [] as readonly { agentId: string; message: string }[])
  expect(kept).toHaveLength(HANDBACK_CAP)
  expect(kept[0]?.agentId).toBe('a3')
  const replaced = withHandback(kept, { agentId: 'a5', message: 'again' })
  expect(replaced.filter(entry => entry.agentId === 'a5')).toEqual([{ agentId: 'a5', message: 'again' }])
  expect(withoutHandback(replaced, 'a5').some(entry => entry.agentId === 'a5')).toBe(false)
})

test('a pipeline agent\'s hand-back never floods the main session: zboard drops it with a pointer to the pane', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  await zboard($, 'run demo')
  const agentId = lastAgent(w)
  await stopAgent($, w, agentId, ANSWERS.research)
  expect(w.prompts).toEqual([])
  expect(await deliverPeer($, agentId, ANSWERS.research)).toEqual({ drop: 'zboard captured the researcher report; see the zboard pane.' })
})

test('a plan agent\'s hand-back never floods the main session: zboard drops it with a pointer to the pane', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  scriptOpenspec(w)
  scriptGit(w)
  await boot($)
  await zboard($, 'changes')
  const ui = await mountPane($, 'terminal', 'zboard-changes')
  await ui.press({ key: 'new' })
  await ui.input({ key: 'compose', text: 'add-export' })
  await ui.press({ key: 'draft' })
  const agentId = lastAgent(w)
  await stopAgent($, w, agentId, json({ question: 'CSV or TSV?', options: ['CSV', 'TSV'], why: 'format' }))
  expect(w.prompts).toEqual([])
  expect(await deliverPeer($, agentId, 'again')).toEqual({ drop: 'zboard captured the brainstormer report; see the zboard pane.' })
})

test('a hand-back from an agent zboard does not run reaches the main session untouched', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  await zboard($, 'run demo')
  await deliverPeer($, 'stranger', 'my own report')
  expect(w.prompts).toEqual(['<agent-message from="stranger">\nmy own report\n</agent-message>'])
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

test('a hand-back zboard never saw as a tool call is read from the agent\'s transcript at its stop', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  await zboard($, 'run demo')
  const agentId = lastAgent(w)
  w.transcripts.set(agentId, [handbackRow('an earlier report'), handbackRow(ANSWERS.research)])
  await $.classic.SubagentStop({ stop_hook_active: false, agent_id: agentId, agent_transcript_path: `/t/${agentId}.jsonl`, agent_type: 'zboard:researcher' })
  await w.clock.advance(0)
  expect(w.spawns.map(spawn => spawn.subagentType)).toEqual(['zboard:researcher', 'zboard:planner'])
})

const subagentStop = ($: Engine, agentId: string) =>
  $.classic.SubagentStop({ stop_hook_active: false, agent_id: agentId, agent_transcript_path: `/t/${agentId}.jsonl`, agent_type: 'zboard' })

test('the next pipeline phase spawns after the stopped agent\'s SubagentStop, never inside it', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  await zboard($, 'run demo')
  handBack(w, lastAgent(w), ANSWERS.research)
  await subagentStop($, lastAgent(w))
  expect(w.spawns).toHaveLength(1)
  await w.clock.advance(0)
  expect(w.spawns.map(spawn => spawn.subagentType)).toEqual(['zboard:researcher', 'zboard:planner'])
})

test('a plan agent\'s retry spawns after its SubagentStop, never inside it', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  scriptOpenspec(w)
  scriptGit(w)
  await boot($)
  await zboard($, 'changes')
  const ui = await mountPane($, 'terminal', 'zboard-changes')
  await ui.press({ key: 'new' })
  await ui.input({ key: 'compose', text: 'add-export' })
  await ui.press({ key: 'draft' })
  handBack(w, lastAgent(w), 'I have no question.')
  await subagentStop($, lastAgent(w))
  expect(w.spawns).toHaveLength(1)
  await w.clock.advance(0)
  expect(w.spawns.map(spawn => spawn.subagentType)).toEqual(['zboard:brainstormer', 'zboard:brainstormer'])
})
