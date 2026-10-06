import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import type { World } from '../testing/world.ts'
import { READY_FILES, scriptOpenspec, scriptRm, seedChange } from '../testing/openspec.ts'
import { installWorld, worldIo } from '../testing/world.ts'
import { scriptGit } from '../testing/zboard.ts'
import type { Io } from './io.ts'
import { acceptProposal, askAnother, rejectProposal } from './plan-apply.ts'
import { refreshChange } from './plan-catalog.ts'
import { proposeFiles } from './plan-draft.ts'
import { installPlanJobs } from './plan-jobs.ts'
import { appendPlan, readPlan } from './plan-store.ts'

const ctx = { options: {} }
const ID = 'add-export'
const DESIGN = `openspec/changes/${ID}/design.md`
const SPEC = `openspec/changes/${ID}/specs/export/spec.md`
const commits = (w: World) => w.runs.filter(argv => argv[0] === 'git' && argv[1] === 'commit')

async function setup(w: World): Promise<{ io: Io; script: ReturnType<typeof scriptOpenspec>; dirty: Map<string, string> }> {
  installPlanJobs()
  const script = scriptOpenspec(w)
  const dirty = scriptGit(w)
  scriptRm(w)
  seedChange(w, ID, READY_FILES)
  const io = worldIo(w)
  await refreshChange(io, ID)
  return { io, script, dirty }
}

const propose = (io: Io, files: Record<string, string>, artifact = 'design') =>
  proposeFiles(io, ID, { kind: 'draft', artifact }, 'comment', Object.entries(files).map(([path, content]) => ({ path, content })))

test('accepting writes, validates and commits only the proposal files as the next revision', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const { io, dirty } = await setup(w)
  dirty.set('src/unrelated.ts', 'x')
  await propose(io, { [DESIGN]: 'design one\n' })
  await acceptProposal(io, ctx, ID)
  await propose(io, { [DESIGN]: 'design two\n' })
  await acceptProposal(io, ctx, ID)
  expect(w.files.get(`/repo/${DESIGN}`)).toBe('design two\n')
  expect(commits(w)).toEqual([
    ['git', 'commit', '--only', '-m', `docs(${ID}): design rev 1`, '--', DESIGN],
    ['git', 'commit', '--only', '-m', `docs(${ID}): design rev 2`, '--', DESIGN],
  ])
  expect((await readPlan(io)).changes[ID]?.revisions.map(r => [r.artifact, r.commit])).toEqual([['design', 'c0ffee1234'], ['design', 'c0ffee1234']])
})

test('reject writes nothing and clears the proposal', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const { io } = await setup(w)
  await propose(io, { [DESIGN]: 'rejected\n' })
  await rejectProposal(io, ID)
  expect(w.files.get(`/repo/${DESIGN}`)).toBe(READY_FILES['design.md'])
  expect((await readPlan(io)).changes[ID]?.proposal).toBeUndefined()
  expect(commits(w)).toEqual([])
})

test('ask another version rejects and relaunches the drafter with the previous proposal and the note', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const { io } = await setup(w)
  await propose(io, { [DESIGN]: 'long version\n' })
  expect(await askAnother(io, ctx, ID, 'shorter please')).toBe(true)
  const prompt = w.spawns[0]?.prompt ?? ''
  expect(prompt).toContain('<zboard-data label="previous proposal" trust="untrusted">')
  expect(prompt).toContain('+long version')
  expect(prompt).toContain('<zboard-data label="user note" trust="untrusted">\nshorter please\n</zboard-data>')
  expect((await readPlan(io)).changes[ID]?.proposal).toBeUndefined()
})

test('a file edited after the proposal makes Accept write nothing and mark it stale', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const { io } = await setup(w)
  await propose(io, { [DESIGN]: 'proposed\n' })
  w.files.set(`/repo/${DESIGN}`, 'edited in the editor\n')
  await acceptProposal(io, ctx, ID)
  expect(w.files.get(`/repo/${DESIGN}`)).toBe('edited in the editor\n')
  expect((await readPlan(io)).changes[ID]?.proposal?.status).toBe('stale')
  expect(w.runs.filter(argv => argv[1] === 'validate')).toHaveLength(1)
  expect(w.toasts.at(-1)).toBe('zboard: the files changed since this proposal; nothing was written — regenerate it')
})

test('a new file that appeared since the proposal is stale', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const { io } = await setup(w)
  await propose(io, { [`openspec/changes/${ID}/verify.md`]: '# Verify\n' }, 'verify')
  w.files.set(`/repo/openspec/changes/${ID}/verify.md`, 'someone else\n')
  await acceptProposal(io, ctx, ID)
  expect(w.files.get(`/repo/openspec/changes/${ID}/verify.md`)).toBe('someone else\n')
  expect((await readPlan(io)).changes[ID]?.proposal?.status).toBe('stale')
})

test('an invalid result is restored byte-for-byte, not committed, and sent back for correction', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const { io, script } = await setup(w)
  await propose(io, { [SPEC]: '## ADDED Requirements\n\n### Requirement: Export CSV\nNo scenario.\n', [`openspec/changes/${ID}/notes.md`]: 'n\n' }, 'specs')
  script.valid = false
  await acceptProposal(io, ctx, ID)
  expect(w.files.get(`/repo/${SPEC}`)).toBe(READY_FILES['specs/export/spec.md'])
  expect(w.files.has(`/repo/openspec/changes/${ID}/notes.md`)).toBe(false)
  expect(commits(w)).toEqual([])
  const rec = (await readPlan(io)).changes[ID]
  expect(rec?.errors.at(-1)).toMatchObject({ hook: 'validate', message: 'ERROR: specs/x/spec.md Requirement must have at least one scenario' })
  expect(w.spawns[0]?.prompt).toContain('<zboard-data label="validator output" trust="untrusted">\nERROR: specs/x/spec.md Requirement must have at least one scenario\n</zboard-data>')
})

test('two Accept presses before the redraw apply the proposal once', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const { io } = await setup(w)
  await propose(io, { [DESIGN]: 'once\n' })
  await Promise.all([acceptProposal(io, ctx, ID), acceptProposal(io, ctx, ID)])
  expect(commits(w)).toHaveLength(1)
  expect((await readPlan(io)).changes[ID]?.revisions).toHaveLength(1)
  expect(w.toasts.at(-1)).toBe('zboard: no proposal is pending')
})

test('a proposal path outside the scope is refused again at apply time', { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
  const w = installWorld(on)
  const { io } = await setup(w)
  await appendPlan(io, [{ type: 'ProposalReady', changeId: ID, proposal: {
    id: 'forged', artifact: 'specs', reason: 'r', status: 'pending', source: { kind: 'draft', artifact: 'specs' },
    files: [{ path: 'openspec/specs/export/spec.md', before: null, after: 'x' }],
  } }])
  await acceptProposal(io, ctx, ID)
  expect(w.files.has('/repo/openspec/specs/export/spec.md')).toBe(false)
  const rec = (await readPlan(io)).changes[ID]
  expect(rec?.proposal).toBeUndefined()
  expect(rec?.errors.at(-1)?.message).toBe('refused path openspec/specs/export/spec.md: only openspec archive writes openspec/specs/')
})
