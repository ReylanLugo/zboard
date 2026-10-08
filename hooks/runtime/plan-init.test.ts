import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { CONFIG_PATH, CONFIG_YAML, DEFAULT_SCHEMA, INIT_FAILED, scriptOpenspec, scriptUninitialized } from '../testing/openspec.ts'
import { argvIs, installWorld, worldIo } from '../testing/world.ts'
import { initOpenspec } from './plan-init.ts'

const inits = (runs: readonly string[][]) => runs.filter(argv => argv[1] === 'init').length

test('two presses before the redraw initialize once', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  scriptUninitialized(w)
  scriptOpenspec(w)
  const io = worldIo(w)
  await Promise.all([initOpenspec(io), initOpenspec(io)])
  expect(inits(w.runs)).toBe(1)
})

test('an initialized folder is never initialized again', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  w.files.set(CONFIG_PATH, CONFIG_YAML)
  scriptUninitialized(w)
  scriptOpenspec(w)
  await initOpenspec(worldIo(w))
  expect(inits(w.runs)).toBe(0)
  expect(w.files.get(CONFIG_PATH)).toBe(CONFIG_YAML)
})

test('without the superpowers-bridge schema the default schema is kept byte for byte', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  scriptUninitialized(w)
  scriptOpenspec(w, { schemas: [DEFAULT_SCHEMA] })
  await initOpenspec(worldIo(w))
  expect(inits(w.runs)).toBe(1)
  expect(w.files.get(CONFIG_PATH)).toBe(CONFIG_YAML)
})

test('a failing schemas call keeps the default schema', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  w.rules.push({ match: argvIs('openspec', 'schemas'), answer: { exitCode: 1, stderr: 'unknown command schemas' } })
  scriptUninitialized(w)
  scriptOpenspec(w)
  await initOpenspec(worldIo(w))
  expect(w.files.get(CONFIG_PATH)).toBe(CONFIG_YAML)
})

test('a failed init is kept as the raw output for the card and writes nothing', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  scriptUninitialized(w, INIT_FAILED)
  scriptOpenspec(w)
  const io = worldIo(w)
  await initOpenspec(io)
  const error = (await io.state.ui.read()).changes.initError
  expect(error).toContain('Error: Insufficient permissions to write to /repo')
  expect(w.runs.filter(argv => argv[1] === 'schemas')).toEqual([])
  expect(w.files.has(CONFIG_PATH)).toBe(false)
})
