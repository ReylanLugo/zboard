import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { finding } from '../testing/plan.ts'
import { READY_FILES, scriptOpenspec, scriptRm, seedChange } from '../testing/openspec.ts'
import type { World } from '../testing/world.ts'
import { argvIs, installWorld, worldIo } from '../testing/world.ts'
import { GREEN, INCOMPLETE, json, lastAgent, scriptGit, scriptPtest } from '../testing/zboard.ts'
import type { Io } from './io.ts'
import { acceptProposal } from './plan-apply.ts'
import { refreshChange } from './plan-catalog.ts'
import { installPlanJobs } from './plan-jobs.ts'
import { planStop } from './plan-runner.ts'
import { appendPlan, readPlan } from './plan-store.ts'
import { proposeVerifyMd, rejudge, resolveFinding, verifyChange } from './plan-verify.ts'

const ctx = { options: {} }
const SPEC = `${READY_FILES['specs/export/spec.md'] ?? ''}\n### Requirement: Import CSV\nThe system SHALL import CSV.\n\n#### Scenario: Import\n- **WHEN** x\n- **THEN** y\n`
const DONE_TASKS = '## 1. Core\n\n- [x] 1.1 Export CSV writer [req: Export CSV]\n  Acceptance: a file\n- [x] 1.2 Import CSV reader [req: Import CSV]\n  Acceptance: rows\n'
const verdict = (requirement: string, value: string, evidence: string[] = [], tests: string[] = []) => ({ requirement, verdict: value, evidence, tests })

async function executed(w: World, tasks = DONE_TASKS): Promise<Io> {
  installPlanJobs()
  scriptOpenspec(w)
  scriptGit(w)
  scriptRm(w)
  seedChange(w, 'a', { ...READY_FILES, 'specs/export/spec.md': SPEC, 'tasks.md': tasks })
  const io = worldIo(w)
  await refreshChange(io, 'a')
  return io
}

test('Verify is disabled while a task is open', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const io = await executed(w, DONE_TASKS.replace('- [x] 1.2', '- [ ] 1.2'))
  expect(await verifyChange(io, ctx, 'a')).toBe(false)
  expect(w.toasts).toEqual(['zboard: 1 task(s) open: 1.2'])
  expect(w.spawns).toEqual([])
})

test('Verify spawns the judge once with every requirement; the change is verifying', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const io = await executed(w)
  expect(await verifyChange(io, ctx, 'a')).toBe(true)
  expect(w.spawns.map(spawn => spawn.subagentType)).toEqual(['zboard:judge'])
  expect(w.spawns[0]?.prompt).toContain('<zboard-data label="requirements" trust="untrusted">\nExport CSV\nImport CSV\n</zboard-data>')
  expect((await readPlan(io)).changes.a?.stage).toBe('verifying')
})

test('cited tests run through ptest from the root and their end lines become evidence', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const io = await executed(w)
  w.files.set('/repo/tests/export.test.ts', 't')
  scriptPtest(w, [GREEN])
  await verifyChange(io, ctx, 'a')
  await planStop(io, ctx, { agentId: lastAgent(w), answer: json({ findings: [verdict('Export CSV', 'true', ['src/export.ts:3'], ['tests/export.test.ts'])] }) })
  expect(w.runs).toContainEqual(['ptest', 'tests/export.test.ts'])
  const findings = (await readPlan(io)).changes.a?.verify?.findings ?? []
  expect(findings.map(f => [f.requirement, f.verdict])).toEqual([['Export CSV', 'true'], ['Import CSV', 'no_evidence']])
  expect(findings[0]?.evidence).toContain('ptest tests/export.test.ts: ptest: demo · passed · 3 tests')
})

test('a true verdict whose cited test cannot run (exit 70 twice) is no_evidence', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const io = await executed(w)
  w.files.set('/repo/tests/export.test.ts', 't')
  scriptPtest(w, [INCOMPLETE, INCOMPLETE])
  await verifyChange(io, ctx, 'a')
  await planStop(io, ctx, { agentId: lastAgent(w), answer: json({ findings: [verdict('Export CSV', 'true', ['src/export.ts:3'], ['tests/export.test.ts'])] }) })
  expect((await readPlan(io)).changes.a?.verify?.findings[0]?.verdict).toBe('no_evidence')
})

test('uncitable test paths are never run', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const io = await executed(w)
  await verifyChange(io, ctx, 'a')
  const tests = ['/etc/passwd', '../outside.test.ts', '--full', 'tests/missing.test.ts']
  await planStop(io, ctx, { agentId: lastAgent(w), answer: json({ findings: [verdict('Export CSV', 'true', ['src/export.ts:3'], tests)] }) })
  expect(w.runs.filter(argv => argv[0] === 'ptest')).toEqual([])
  const first = (await readPlan(io)).changes.a?.verify?.findings[0]
  expect(first?.verdict).toBe('no_evidence')
  expect(first?.evidence).toContain('ptest --full: not a repository test file; not run')
})

test('invalid judge output twice records every requirement as no_evidence', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const io = await executed(w)
  await verifyChange(io, ctx, 'a')
  await planStop(io, ctx, { agentId: lastAgent(w), answer: 'All good.' })
  await planStop(io, ctx, { agentId: lastAgent(w), answer: 'Really, all good.' })
  expect((await readPlan(io)).changes.a?.verify?.findings.map(f => [f.requirement, f.verdict])).toEqual([['Export CSV', 'no_evidence'], ['Import CSV', 'no_evidence']])
})

test('fix_code proposes a linked task and returns the change to executing', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const io = await executed(w)
  await appendPlan(io, [{ type: 'VerifyRecorded', changeId: 'a', scope: [], findings: [finding({ requirement: 'Export CSV', verdict: 'false' }), finding({ requirement: 'Import CSV' })] }])
  expect(await resolveFinding(io, ctx, 'a', 'r:Export CSV', 'fix_code')).toBe(true)
  expect(w.spawns[0]?.prompt).toContain('Add exactly one task to tasks.md that changes the code so this requirement holds: Export CSV')
  const fixed = `${DONE_TASKS}- [ ] 1.3 Fix the CSV export [req: Export CSV]\n  Acceptance: the export test passes\n`
  await planStop(io, ctx, { agentId: lastAgent(w), answer: json({ files: [{ path: 'openspec/changes/a/tasks.md', content: fixed }], notes: '' }) })
  await acceptProposal(io, ctx, 'a')
  const rec = (await readPlan(io)).changes.a
  expect(rec?.verify?.findings[0]).toMatchObject({ resolution: 'fix_code', linkedTask: '1.3' })
  expect(rec?.stage).toBe('executing')
})

test('add_test proposes a TDD task linked to the finding', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const io = await executed(w)
  await appendPlan(io, [{ type: 'VerifyRecorded', changeId: 'a', scope: [], findings: [finding({ requirement: 'Import CSV', verdict: 'no_evidence' })] }])
  await resolveFinding(io, ctx, 'a', 'r:Import CSV', 'add_test')
  expect(w.spawns[0]?.prompt).toContain('Add exactly one TDD task to tasks.md that writes the missing test proving: Import CSV')
  await planStop(io, ctx, { agentId: lastAgent(w), answer: json({ files: [{ path: 'openspec/changes/a/tasks.md', content: `${DONE_TASKS}- [ ] 1.3 Test Import CSV [req: Import CSV]\n  Acceptance: test fails first\n` }], notes: '' }) })
  expect((await readPlan(io)).changes.a?.proposal?.source).toMatchObject({ artifact: 'tasks', finding: 'r:Import CSV' })
})

test('accepting a false finding is refused', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const io = await executed(w)
  await appendPlan(io, [{ type: 'VerifyRecorded', changeId: 'a', scope: [], findings: [finding({ requirement: 'Export CSV', verdict: 'false' })] }])
  expect(await resolveFinding(io, ctx, 'a', 'r:Export CSV', 'accepted')).toBe(false)
  expect(w.toasts).toEqual(['zboard: accepted is not allowed for a false finding'])
  expect((await readPlan(io)).changes.a?.verify?.findings[0]?.resolution).toBeUndefined()
})

test('re-judge covers only the affected requirements and keeps the other verdicts', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const io = await executed(w)
  await appendPlan(io, [{ type: 'VerifyRecorded', changeId: 'a', scope: [], findings: [
    finding({ requirement: 'Export CSV', verdict: 'false', resolution: 'fix_code', linkedTask: '1.1' }),
    finding({ requirement: 'Import CSV' }),
  ] }])
  expect(await rejudge(io, ctx, 'a')).toBe(true)
  expect(w.spawns[0]?.prompt).toContain('<zboard-data label="requirements" trust="untrusted">\nExport CSV\n</zboard-data>')
  await planStop(io, ctx, { agentId: lastAgent(w), answer: json({ findings: [verdict('Export CSV', 'true', ['src/export.ts:9'])] }) })
  const verify = (await readPlan(io)).changes.a?.verify
  expect(verify?.runs).toBe(2)
  expect(verify?.findings.map(f => [f.requirement, f.verdict])).toEqual([['Import CSV', 'true'], ['Export CSV', 'true']])
})

test('an accepted no_evidence finding passes the run and verify.md records it through a diff', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const io = await executed(w)
  await appendPlan(io, [{ type: 'VerifyRecorded', changeId: 'a', scope: [], findings: [finding({ requirement: 'Export CSV' }), finding({ requirement: 'Import CSV', verdict: 'no_evidence' })] }])
  await resolveFinding(io, ctx, 'a', 'r:Import CSV', 'accepted')
  expect((await readPlan(io)).changes.a?.verify?.passed).toBe(true)
  expect(await proposeVerifyMd(io, 'a')).toBe(true)
  const file = (await readPlan(io)).changes.a?.proposal?.files[0]
  expect(file).toMatchObject({ path: 'openspec/changes/a/verify.md', before: null })
  expect(file?.after).toContain('- Import CSV: no_evidence, accepted without evidence')
  expect(w.files.has('/repo/openspec/changes/a/verify.md')).toBe(false)
})
