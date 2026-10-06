import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { project } from '../domain/project.ts'
import { evs, loaded, parsed } from '../testing/factories.ts'
import { agentOf, boot, setupDemo, status, zboard } from '../testing/zboard.ts'
import { installWorld, worldIo } from '../testing/world.ts'
import { activityFor } from './capture.ts'

const usage = { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, model: 'claude-sonnet-5-5' }

test('activityFor touches only a known, open run', () => {
  const board = project(evs([
    loaded(parsed('1.1')),
    { type: 'PhaseStarted', taskId: '1.1', phase: 'code', attempt: 1, agentId: 'a1', agentType: 'zboard:implementer', role: 'implementer', model: 'm', baseline: {} },
  ]))
  expect(activityFor(board, 'a1', 'Edit')).toEqual([{ type: 'AgentActivity', agentId: 'a1', tool: 'Edit' }])
  expect(activityFor(board, 'a1', undefined, 42)).toEqual([{ type: 'AgentActivity', agentId: 'a1', tokens: 42 }])
  expect(activityFor(board, 'ghost', 'Write')).toEqual([])
})

test('SubagentStop closes the run with endedAt and transcript path', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  await zboard($, 'run demo')
  await w.clock.advance(1_000)
  await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'agent-1', agent_transcript_path: '/t/agent-1.jsonl', agent_type: 'zboard:researcher' })
  expect(await agentOf($, 'agent-1')).toMatchObject({ agentId: 'agent-1', transcriptPath: '/t/agent-1.jsonl', endedAt: 1_001_000 })
  expect((await status($)).tasks[0]?.agents.map(agent => agent.agentId)).not.toContain('agent-1')
})

test('turn.complete usage adds tokens to the agent run', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  await zboard($, 'run demo')
  await $.turn.complete({ answer: 'working', durationMs: 10, isAborted: false, turnId: 't1', agentId: 'agent-1', reason: 'answer', usage })
  expect(await agentOf($, 'agent-1')).toMatchObject({ tokens: 1500 })
})

test('SubagentStart refreshes activity of a known agent', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  await zboard($, 'run demo')
  await w.clock.advance(5_000)
  await $.classic.SubagentStart({ agent_id: 'agent-1', agent_type: 'zboard:researcher' })
  expect(await agentOf($, 'agent-1')).toMatchObject({ lastActivityAt: 1_005_000 })
})

test('events for an agent that belongs to no task change nothing', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  await boot($)
  await zboard($, 'run demo')
  const before = (await status($)).events
  await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, turnId: 't2', agentId: 'stranger', reason: 'answer', usage })
  await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'stranger', agent_transcript_path: '/t/s.jsonl', agent_type: 'Explore' })
  expect((await status($)).events).toBe(before)
})

test('a tool call carrying agentId updates currentTool (spike: the kit forwards agentId)', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  on('tool.call', { tool: 'Read' }, () => ({ result: 'contents', text: 'contents' }))
  await boot($)
  await zboard($, 'run demo')
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/a.ts', agentId: 'agent-1' } as never)
  expect(await agentOf($, 'agent-1')).toMatchObject({ currentTool: 'Read' })
})
