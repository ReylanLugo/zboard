import { expect, test } from 'claude-code/testing'

// Spikes for Claude Code 2.1.289's plugin test kit. Task 6.1 deletes this file
// once board_status replaces the probe code.

test('harness: session.start reaches the plugin and a registered command answers', async ($, on) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__zboard__${e.name}` } }))
  on('agent.register', (_$, e) => ({ value: { agent: `zboard:${e.name}` } }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ command: 'zboard', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 160 } })
  expect(ran.text).toStartWith('zboard: probe=')
})

test('harness: a plugin tool answers $.tool.call without core beneath it', async ($, on) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__zboard__${e.name}` } }))
  on('agent.register', (_$, e) => ({ value: { agent: `zboard:${e.name}` } }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const out = await $.tool.call({ tool: 'mcp__zboard__board_status' })
  expect(String(out.result)).toStartWith('probe=')
})

test('harness: $.state is held natively by the kit', async ($, on) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__zboard__${e.name}` } }))
  on('agent.register', (_$, e) => ({ value: { agent: `zboard:${e.name}` } }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ command: 'zboard', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 160 } })
  expect(ran.text).toBe('zboard: probe=1')
})
