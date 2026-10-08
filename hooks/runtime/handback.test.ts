import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { scriptOpenspec } from '../testing/openspec.ts'
import { mountPane } from '../testing/ui.ts'
import type { World } from '../testing/world.ts'
import { handbackRow, installWorld } from '../testing/world.ts'
import { ANSWERS, boot, deliverPeer, json, lastAgent, scriptGit, setupDemo, stopAgent, stopAgentWithText, zboard } from '../testing/zboard.ts'
import { CLAIM_CAP, claimLedger, withClaim } from './complete.ts'
import { handbackFrom, nonBlank } from './handback.ts'

const subagentStop = ($: Engine, agentId: string) =>
  $.classic.SubagentStop({ stop_hook_active: false, agent_id: agentId, agent_transcript_path: `/t/${agentId}.jsonl`, agent_type: 'zboard' })

/** The agent's run holds its SubagentHandback call; zboard never sees the call itself (re-entry). */
const handBack = (w: World, agentId: string, message: string): void => {
  w.transcripts.set(agentId, [...(w.transcripts.get(agentId) ?? []), handbackRow(message)])
}

test('the last SubagentHandback report in an agent\'s messages is its answer; none without one', () => {
  expect(handbackFrom([handbackRow('first'), { role: 'assistant', text: 'thinking' } as never, handbackRow('second')])).toBe('second')
  expect(handbackFrom([{ role: 'assistant', text: 'no report' } as never])).toBeUndefined()
  expect(handbackFrom([])).toBeUndefined()
  expect(nonBlank('  ')).toBeUndefined()
  expect(nonBlank('text')).toBe('text')
})

test('an agent\'s completion is claimed once; the ledger keeps the newest claims up to its cap', () => {
  const claim = claimLedger()
  expect(claim('a1')).toBe(true)
  expect(claim('a1')).toBe(false)
  expect(claim('a2')).toBe(true)
  const many = Array.from({ length: CLAIM_CAP + 2 }, (_, index) => `x${index}`).reduce(withClaim, [] as readonly string[])
  expect(many).toHaveLength(CLAIM_CAP)
  expect(many[0]).toBe('x2')
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

test('a turn.complete completes the agent; its later SubagentStop is a no-op', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  await zboard($, 'run demo')
  const agentId = lastAgent(w)
  await stopAgent($, w, agentId, ANSWERS.research)
  await subagentStop($, agentId)
  await w.clock.advance(0)
  expect(w.spawns.map(spawn => spawn.subagentType)).toEqual(['zboard:researcher', 'zboard:planner'])
})

test('the main loop\'s turn.complete and a stranger agent\'s complete nothing', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  await zboard($, 'run demo')
  await $.turn.complete({ answer: ANSWERS.research, durationMs: 1, isAborted: false, turnId: 'main', reason: 'answer' })
  await stopAgentWithText($, w, 'stranger', ANSWERS.research)
  expect(w.spawns.map(spawn => spawn.subagentType)).toEqual(['zboard:researcher'])
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
