import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { changeFingerprint } from '../adapters/artifacts.ts'
import { READY_FILES, scriptOpenspec, seedChange } from '../testing/openspec.ts'
import type { World } from '../testing/world.ts'
import { argvIs, installWorld, worldIo } from '../testing/world.ts'
import { json, lastAgent } from '../testing/zboard.ts'
import type { Io } from './io.ts'
import { renderDiagrams, resetMmdcProbe } from './mermaid.ts'
import { refreshChange } from './plan-catalog.ts'
import { explainChange, explainKey, isExplanationCurrent } from './plan-explain.ts'
import { installPlanJobs } from './plan-jobs.ts'
import { planStop } from './plan-runner.ts'
import { readPlan } from './plan-store.ts'

const ctx = { options: {} }
const EXPLANATION = { overview: 'Exports CSV.', sections: [{ title: 'Flow', body: 'Rows to file.' }], diagrams: [{ title: 'Flow', mermaid: 'graph TD; A-->B' }] }
const noMmdc = (w: World) => w.rules.push({ match: argvIs('mmdc', '--version'), answer: { exitCode: 127, stderr: 'mmdc: command not found' } })

async function ready(w: World): Promise<Io> {
  resetMmdcProbe()
  installPlanJobs()
  scriptOpenspec(w)
  seedChange(w, 'a', READY_FILES)
  const io = worldIo(w)
  await refreshChange(io, 'a')
  return io
}

test('Explain twice without a change spawns the explainer once', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  noMmdc(w)
  const io = await ready(w)
  await explainChange(io, ctx, 'a')
  expect(w.spawns[0]?.subagentType).toBe('zboard:explainer')
  await planStop(io, ctx, { agentId: lastAgent(w), answer: json(EXPLANATION) })
  const rec = (await readPlan(io)).changes.a
  expect(rec === undefined ? false : isExplanationCurrent(rec)).toBe(true)
  expect(w.store.get(explainKey('a'))).toMatchObject({ explanation: EXPLANATION })
  await explainChange(io, ctx, 'a')
  expect(w.spawns).toHaveLength(1)
  expect(w.toasts.at(-1)).toBe('zboard: the explanation is current')
})

test('a stored explanation with the current fingerprint is reused without an agent', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const io = await ready(w)
  w.store.set(explainKey('a'), { fingerprint: await changeFingerprint(io, 'a'), explanation: EXPLANATION })
  await explainChange(io, ctx, 'a')
  expect(w.spawns).toEqual([])
  expect((await readPlan(io)).changes.a?.explanation?.value).toEqual(EXPLANATION)
})

test('an artifact edit makes the explanation outdated and the next Explain spawns again', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  noMmdc(w)
  const io = await ready(w)
  await explainChange(io, ctx, 'a')
  await planStop(io, ctx, { agentId: lastAgent(w), answer: json(EXPLANATION) })
  w.files.set('/repo/openspec/changes/a/design.md', '## Context\n\nChanged.\n')
  await refreshChange(io, 'a')
  const rec = (await readPlan(io)).changes.a
  expect(rec === undefined ? true : isExplanationCurrent(rec)).toBe(false)
  await explainChange(io, ctx, 'a')
  expect(w.spawns).toHaveLength(2)
})

test('without mmdc the diagrams stay unrendered', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  resetMmdcProbe()
  noMmdc(w)
  expect(await renderDiagrams(worldIo(w), EXPLANATION.diagrams)).toEqual(EXPLANATION.diagrams)
  expect(w.runs).toEqual([['mmdc', '--version']])
})

test('with mmdc each diagram gets SVG and PNG; one failure leaves the others rendered', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  resetMmdcProbe()
  const isPng = (argv: readonly string[]) => argv[0] === 'mmdc' && argv[1] === '--input' && argv[4] !== '-'
  w.rules.push(
    { match: argvIs('mmdc', '--version'), answer: { stdout: '11.4.0\n' } },
    { match: argvIs('mkdir', '-p'), answer: {} },
    { match: argvIs('mmdc', '--input', '-', '--output', '-'), once: true, answer: { exitCode: 1, stderr: 'Parse error on line 1' } },
    { match: argvIs('mmdc', '--input', '-', '--output', '-'), answer: { stdout: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' } },
    { match: isPng, answer: {} },
  )
  const out = await renderDiagrams(worldIo(w), [{ title: 'Bad', mermaid: 'graph TD; A--' }, { title: 'Good', mermaid: 'graph TD; A-->B' }])
  expect(out[0]).toEqual({ title: 'Bad', mermaid: 'graph TD; A--', png: expect.stringMatching(/^\/tmp\/zboard-mermaid\/[0-9a-f]{16}\.png$/) })
  expect(out[1]).toMatchObject({ title: 'Good', svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' })
  expect(w.runs.filter(argv => argv[0] === 'mmdc' && argv[1] === '--version')).toHaveLength(1)
})
