import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import type { Io } from '../runtime/io.ts'
import { installWorld, worldIo } from '../testing/world.ts'
import { readProjectConfig } from '../adapters/config-io.ts'
import { configWarnings, displayModel, globalLayer, parseProjectConfig, resolveChoice, stepUp } from './config.ts'

const plain = { loop: 0, autoEscalate: false }

test('with no configuration the planner spawns with opus 5.5 and xhigh', () => {
  expect(resolveChoice('planner', {}, plain)).toEqual({
    model: 'opus 5.5', modelId: 'claude-opus-5-5', effort: 'xhigh', modelSource: 'default', effortSource: 'default', warnings: [],
  })
})

test('project overrides global, field by field', () => {
  const resolved = resolveChoice('reviewer', { global: { model: 'sonnet 5.5', effort: 'high' }, project: { model: 'opus 5.5', effort: 'max' } }, plain)
  expect(resolved).toMatchObject({ model: 'opus 5.5', effort: 'max', modelSource: 'project', effortSource: 'project' })
  const mixed = resolveChoice('reviewer', { global: { effort: 'low' }, project: { model: 'sonnet 5.5' } }, plain)
  expect(mixed).toMatchObject({ model: 'sonnet 5.5', effort: 'low', modelSource: 'project', effortSource: 'global' })
})

test('a task override wins over everything', () => {
  const resolved = resolveChoice('implementer', { task: { model: 'opus 5.5', effort: 'high' }, project: { model: 'sonnet 5.5', effort: 'low' } }, plain)
  expect(resolved).toMatchObject({ model: 'opus 5.5', effort: 'high', modelSource: 'task', effortSource: 'task' })
})

test('an unknown effort falls back to the default with a warning', () => {
  const resolved = resolveChoice('implementer', { project: { effort: 'ultra' } }, plain)
  expect(resolved.effort).toBe('medium')
  expect(resolved.warnings).toEqual(['project implementer effort "ultra" is invalid; using medium'])
})

test('effort is ignored for a model without effort support', () => {
  const resolved = resolveChoice('tdd', { project: { model: 'haiku 4.5', effort: 'high' } }, plain)
  expect(resolved).toMatchObject({ modelId: 'claude-haiku-4-5', effortSource: 'unsupported' })
  expect(resolved.effort).toBeUndefined()
})

test('auto-escalation raises the refactorer one step on loop 3 only when enabled, never above max', () => {
  expect(resolveChoice('refactorer', {}, { loop: 3, autoEscalate: false }).effort).toBe('medium')
  expect(resolveChoice('refactorer', {}, { loop: 3, autoEscalate: true })).toMatchObject({ effort: 'high', effortSource: 'escalated' })
  expect(resolveChoice('refactorer', {}, { loop: 2, autoEscalate: true }).effort).toBe('medium')
  expect(stepUp('max')).toBe('max')
})

test('global pickers count only when they differ from the default', () => {
  expect(globalLayer({ reviewerModel: 'sonnet 5.5', reviewerEffort: 'high' }, 'reviewer')).toEqual({ model: 'sonnet 5.5', effort: undefined })
})

test('a malformed project config is ignored with a warning', () => {
  expect(parseProjectConfig('{ not json')).toEqual({ layers: {}, warnings: ['.zboard/config.json is not valid JSON; ignoring it'] })
  const parsedConfig = parseProjectConfig('{"agents":{"reviewer":{"model":"opus 5.5","effort":"max"},"wizard":{}},"autoEscalate":true}')
  expect(parsedConfig).toEqual({
    layers: { reviewer: { model: 'opus 5.5', effort: 'max' } },
    autoEscalate: true,
    warnings: ['.zboard/config.json: unknown agent "wizard"'],
  })
})

test('configWarnings collects project warnings and invalid values for every role', () => {
  const project = parseProjectConfig('{"agents":{"implementer":{"effort":"ultra"}}}')
  expect(configWarnings(project, {})).toEqual(['project implementer effort "ultra" is invalid; using medium'])
})

test('displayModel maps ids back to names', () => {
  expect(displayModel('claude-sonnet-5-5')).toBe('sonnet 5.5')
  expect(displayModel('custom-model')).toBe('custom-model')
})

test('readProjectConfig reads .zboard/config.json and tolerates its absence', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  w.files.set('/repo/.zboard/config.json', '{"agents":{"planner":{"effort":"max"}}}')
  expect(await ((async ($: Io) => [await readProjectConfig($)]))(worldIo(w))).toEqual([{ layers: { planner: { effort: 'max' } }, warnings: [] }])
})
