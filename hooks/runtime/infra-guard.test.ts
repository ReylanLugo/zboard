import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { installWorld } from '../testing/world.ts'
import { boot, setupDemo, zboard } from '../testing/zboard.ts'
import { caughtBash, infraDenial } from './infra-guard.ts'

const DENY = infraDenial('gcloud')

test('the denial names the CLI', () => {
  expect(DENY).toBe('zboard: agents must not run infrastructure CLIs (gcloud); work only on local files and the test command.')
})

test('re-entry: an agent\'s infrastructure CLI is refused, its other Bash and the main session pass', () => {
  const reentry = { error: { kind: 're-entry' }, called: false } as const
  expect(caughtBash('Bash', 'a1', 'FOO=1 gcloud x', reentry)).toBe(DENY)
  expect(caughtBash('Bash', 'a1', 'rg gcloud src/', reentry)).toBeUndefined()
  expect(caughtBash('Bash', undefined, 'gcloud x', reentry)).toBeUndefined()
  expect(caughtBash('Read', 'a1', 'gcloud x', reentry)).toBeUndefined()
})

test('a failure of the hook passes what it let through and refuses an agent\'s infrastructure CLI otherwise', () => {
  expect(caughtBash('Bash', 'a1', 'gcloud x', { error: { kind: 'throw' }, called: true })).toBeUndefined()
  expect(caughtBash('Bash', 'a1', 'gcloud x', { error: { kind: 'timeout' }, called: false })).toBe(DENY)
  expect(caughtBash('Bash', 'a1', 'ls', { error: { kind: 'timeout' }, called: false })).toBeUndefined()
})

test('a zboard agent\'s gcloud Bash is denied, its rg gcloud passes, and the main session is untouched', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  setupDemo(w)
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'ran', text: 'ran' }))
  await boot($)
  await zboard($, 'run demo')
  const call = (command: string, agentId?: string) => $.tool.call({ tool: 'Bash', command, ...(agentId === undefined ? {} : { agentId }) } as never)
  expect((await call('gcloud compute instances list', 'agent-1')).deny).toBe(DENY)
  expect((await call('cd infra && terraform apply', 'agent-1')).deny).toBe(infraDenial('terraform'))
  expect((await call('rg gcloud src/', 'agent-1')).deny).toBeUndefined()
  expect((await call('gcloud config list')).deny).toBeUndefined()
  expect((await call('gcloud config list', 'someone-else')).deny).toBeUndefined()
})
