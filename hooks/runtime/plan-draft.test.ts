import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { proposalText } from '../plan/proposals.ts'
import { READY_FILES, scriptOpenspec, seedChange } from '../testing/openspec.ts'
import { argvIs, installWorld, worldIo } from '../testing/world.ts'
import { json, lastAgent } from '../testing/zboard.ts'
import { draftNext } from './plan-actions.ts'
import { refreshChange } from './plan-catalog.ts'
import { commentOn, proposeFiles } from './plan-draft.ts'
import { installPlanJobs } from './plan-jobs.ts'
import { planStop } from './plan-runner.ts'
import { readPlan } from './plan-store.ts'

const ctx = { options: {} }
const PROPOSAL = json({ files: [{ path: 'openspec/changes/a/proposal.md', content: '## Why\n\nExport data.\n' }], notes: 'first draft' })

test('draft next drafts the first ready artifact with its instructions and accepted dependencies', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  installPlanJobs()
  scriptOpenspec(w)
  seedChange(w, 'a', { 'brainstorm.md': '# Brainstorm\n\nExport CSV.\n' })
  const io = worldIo(w)
  await refreshChange(io, 'a')
  expect(await draftNext(io, ctx, 'a')).toBe(true)
  expect(w.runs).toContainEqual(['openspec', 'instructions', 'proposal', '--change', 'a', '--json'])
  const prompt = w.spawns[0]?.prompt ?? ''
  expect(w.spawns[0]?.subagentType).toBe('zboard:drafter')
  expect(prompt).toContain('Draft the artifact "proposal"')
  expect(prompt).toContain('<zboard-data label="openspec/changes/a/brainstorm.md" trust="untrusted">\n# Brainstorm\n\nExport CSV.\n\n</zboard-data>')
  await planStop(io, ctx, { agentId: lastAgent(w), answer: PROPOSAL })
  const proposal = (await readPlan(io)).changes.a?.proposal
  expect(proposal).toMatchObject({ artifact: 'proposal', reason: 'first draft', status: 'pending', files: [{ path: 'openspec/changes/a/proposal.md', before: null }] })
  expect(w.files.has('/repo/openspec/changes/a/proposal.md')).toBe(false)
})

test('draft next is disabled and names the missing dependency when everything left is blocked', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  installPlanJobs()
  w.rules.push({ match: argvIs('openspec', 'status'), answer: { stdout: JSON.stringify({ schemaName: 'other', applyRequires: ['tasks'], artifacts: [
    { id: 'proposal', outputPath: 'proposal.md', status: 'done', requires: [] },
    { id: 'specs', outputPath: 'specs/**/*.md', status: 'blocked', requires: ['proposal', 'research'] },
    { id: 'tasks', outputPath: 'tasks.md', status: 'blocked', requires: ['specs'] },
  ] }) } })
  scriptOpenspec(w)
  seedChange(w, 'a', { 'proposal.md': '## Why\n' })
  const io = worldIo(w)
  await refreshChange(io, 'a')
  expect(await draftNext(io, ctx, 'a')).toBe(false)
  expect(w.toasts).toEqual(['zboard: blocked: specs needs research'])
  expect(w.spawns).toEqual([])
})

test('the drafter runs with the model and effort from .zboard/config.json', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  installPlanJobs()
  scriptOpenspec(w)
  seedChange(w, 'a', { 'brainstorm.md': 'b' })
  w.files.set('/repo/.zboard/config.json', '{"agents":{"drafter":{"model":"sonnet 5.5","effort":"medium"}}}')
  const io = worldIo(w)
  await refreshChange(io, 'a')
  await draftNext(io, ctx, 'a')
  expect(w.spawns).toHaveLength(1)
  expect(w.agentSpecs.get('drafter')).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'medium' })
})

test('a comment reaches the drafter as data and comes back as a per-file diff proposal', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  installPlanJobs()
  scriptOpenspec(w)
  seedChange(w, 'a', READY_FILES)
  const io = worldIo(w)
  await refreshChange(io, 'a')
  expect(await commentOn(io, ctx, 'a', 'specs', 'split requirement X into two')).toBe(true)
  expect(w.spawns[0]?.prompt).toContain('<zboard-data label="user note" trust="untrusted">\nsplit requirement X into two\n</zboard-data>')
  const split = `${READY_FILES['specs/export/spec.md'] ?? ''}\n### Requirement: Export TSV\nThe system SHALL export TSV.\n\n#### Scenario: TSV\n- **WHEN** x\n- **THEN** y\n`
  await planStop(io, ctx, { agentId: lastAgent(w), answer: json({ files: [{ path: 'openspec/changes/a/specs/export/spec.md', content: split }], notes: '' }) })
  const proposal = (await readPlan(io)).changes.a?.proposal
  expect(proposal?.reason).toBe('comment: split requirement X into two')
  expect(proposal === undefined ? '' : proposalText(proposal)).toContain('+### Requirement: Export TSV')
})

test('a path outside the change is refused and nothing is proposed or written', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  installPlanJobs()
  scriptOpenspec(w)
  seedChange(w, 'a', { 'brainstorm.md': 'b' })
  const io = worldIo(w)
  await refreshChange(io, 'a')
  await draftNext(io, ctx, 'a')
  await planStop(io, ctx, { agentId: lastAgent(w), answer: json({ files: [{ path: 'hooks/register.tsx', content: 'pwned' }], notes: '' }) })
  const rec = (await readPlan(io)).changes.a
  expect(rec?.proposal).toBeUndefined()
  expect(rec?.errors.at(-1)?.message).toBe('refused path hooks/register.tsx: outside openspec/changes/a/')
  expect(w.files.has('/repo/hooks/register.tsx')).toBe(false)
})

test('a second proposal while one is pending is refused with a PlanError', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  installPlanJobs()
  scriptOpenspec(w)
  seedChange(w, 'a', READY_FILES)
  const io = worldIo(w)
  await refreshChange(io, 'a')
  const source = { kind: 'draft' as const, artifact: 'design' }
  expect(await proposeFiles(io, 'a', source, 'one', [{ path: 'openspec/changes/a/design.md', content: 'one\n' }])).toBe(true)
  await proposeFiles(io, 'a', source, 'two', [{ path: 'openspec/changes/a/design.md', content: 'two\n' }])
  const rec = (await readPlan(io)).changes.a
  expect(rec?.proposal?.reason).toBe('one')
  expect(rec?.errors.at(-1)?.message).toBe('a proposal is already pending for a')
  expect(await commentOn(io, ctx, 'a', 'design', 'more')).toBe(false)
  expect(w.toasts.at(-1)).toBe('zboard: a proposal is pending')
})

test('a drafter answering prose twice is spawned exactly twice and proposes nothing', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  installPlanJobs()
  scriptOpenspec(w)
  seedChange(w, 'a', { 'brainstorm.md': 'b' })
  const io = worldIo(w)
  await refreshChange(io, 'a')
  await draftNext(io, ctx, 'a')
  await planStop(io, ctx, { agentId: lastAgent(w), answer: 'I wrote proposal.md for you.' })
  await planStop(io, ctx, { agentId: lastAgent(w), answer: 'Done.' })
  const rec = (await readPlan(io)).changes.a
  expect(w.spawns).toHaveLength(2)
  expect(rec?.proposal).toBeUndefined()
  expect(rec?.errors.at(-1)?.hook).toBe('agent.drafter')
  expect(w.files.has('/repo/openspec/changes/a/proposal.md')).toBe(false)
})
