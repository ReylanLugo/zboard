import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { READY_FILES, READY_SPEC, scriptOpenspec, seedChange } from '../testing/openspec.ts'
import { SURFACES, findIn, labelOf, mountPane, stepsOf } from '../testing/ui.ts'
import { installWorld } from '../testing/world.ts'
import { boot, zboard } from '../testing/zboard.ts'

const TWO_SPECS = `${READY_SPEC}\n### Requirement: Import CSV\nThe system SHALL import.\n\n#### Scenario: Import\n- **WHEN** x\n- **THEN** y\n`

for (const surface of SURFACES) {
  test(`${surface}: the stepper shows done, current and blocked artifacts`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    scriptOpenspec(w)
    seedChange(w, 'a', { 'brainstorm.md': '# B\n', 'proposal.md': '## Why\n' })
    await boot($)
    await zboard($, 'changes a')
    const ui = await mountPane($, surface, 'zboard-changes')
    await ui.press({ key: 'draft' })
    expect(w.spawns.map(spawn => spawn.subagentType)).toEqual(['zboard:drafter'])
    const steps = (await stepsOf(ui)).map(step => step.text)
    expect(steps.slice(0, 3)).toEqual(['● brainstorm', '● [proposal]', '◐ design'])
    expect(steps).toContain('○ tasks')
    await ui.unmount()
  })

  test(`${surface}: the stepper is one wrapping row of non-shrinking steps, each its own selectable artifact`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    scriptOpenspec(w)
    seedChange(w, 'a', { 'brainstorm.md': '# B\n', 'proposal.md': '## Why\n' })
    await boot($)
    await zboard($, 'changes a')
    const ui = await mountPane($, surface, 'zboard-changes')
    expect(await ui.drawn()).toMatchObject({ type: 'Box' })
    expect((await ui.find({ key: 'stepper' }))?.props).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 2 })
    const steps = await stepsOf(ui)
    expect(steps.map(step => step.key)).toEqual(['brainstorm', 'proposal', 'design', 'specs', 'tasks', 'plan', 'verify', 'retrospective'].map(id => `step:${id}`))
    for (const step of steps) expect(step.props).toMatchObject({ flexShrink: 0, gap: 1 })
    expect(await ui.find({ key: 'artifacts' })).toBeUndefined()
    expect(await labelOf(ui, 'artifact:brainstorm')).toBe('brainstorm')
    await ui.press({ key: 'artifact:brainstorm' })
    expect(await labelOf(ui, 'artifact:brainstorm')).toBe('[brainstorm]')
    expect(await labelOf(ui, 'artifact:proposal')).toBe('proposal')
    await ui.press({ key: 'artifact:proposal' })
    expect(await labelOf(ui, 'artifact:proposal')).toBe('[proposal]')
    expect(await labelOf(ui, 'artifact:brainstorm')).toBe('brainstorm')
    await ui.unmount()
  })

  test(`${surface}: a change whose plan is not written shows one dim readiness line and no failing checks`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    scriptOpenspec(w)
    seedChange(w, 'a', { 'brainstorm.md': '# B\n', 'proposal.md': '## Why\n' })
    await boot($)
    await zboard($, 'changes a')
    const ui = await mountPane($, surface, 'zboard-changes')
    const line = await ui.find({ key: 'readiness' })
    expect(line?.text).toBe('readiness · checked once the plan is written')
    expect((await findIn(ui, 'readiness', 'Text'))?.props).toMatchObject({ dimColor: true })
    expect(await ui.find({ key: 'check:validate' })).toBeUndefined()
    expect((await ui.findAll({ type: 'Box' })).filter(box => box.key?.startsWith('check:') === true)).toEqual([])
    await ui.unmount()
  })

  test(`${surface}: with the plan written, a no-delta-only validation stays a readable failing check`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    scriptOpenspec(w)
    seedChange(w, 'a', Object.fromEntries(Object.entries(READY_FILES).filter(([path]) => !path.startsWith('specs/'))))
    await boot($)
    await zboard($, 'changes a')
    const ui = await mountPane($, surface, 'zboard-changes')
    expect((await ui.find({ key: 'readiness' }))?.text).toMatch(/^readiness ✗ validate/)
    expect((await ui.find({ key: 'check:validate' }))?.text).toBe('✗ validate: no delta spec yet')
    await ui.unmount()
  })

  test(`${surface}: the readiness bar and Summary render without any agent`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    scriptOpenspec(w)
    seedChange(w, 'a', READY_FILES)
    await boot($)
    await zboard($, 'changes a')
    const ui = await mountPane($, surface, 'zboard-changes')
    expect((await ui.find({ key: 'readiness' }))?.text).toBe('readiness ✓ 6/6')
    expect((await ui.find({ key: 'doc:openspec/changes/a/proposal.md' }))?.props.text).toBe('## Why\n\nExport data.\n')
    expect((await ui.find({ key: 'doc:openspec/changes/a/design.md' }))?.props.text).toBe('## Context\n\nA CSV exporter.\n')
    expect(w.spawns).toEqual([])
    await ui.unmount()
  })

  test(`${surface}: Specs flags uncovered requirements; Tasks renders tasks.md; History starts empty`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    scriptOpenspec(w)
    seedChange(w, 'a', { ...READY_FILES, 'specs/export/spec.md': TWO_SPECS })
    await boot($)
    await zboard($, 'changes a')
    const ui = await mountPane($, surface, 'zboard-changes')
    expect((await ui.find({ key: 'readiness' }))?.text).toBe('readiness ✓ 6/6')
    await ui.press({ key: 'tab:specs' })
    expect((await ui.find({ key: 'uncovered:Import CSV' }))?.text).toBe('uncovered: Import CSV')
    expect(await ui.find({ key: 'uncovered:Export CSV' })).toBeUndefined()
    await ui.press({ key: 'tab:tasks' })
    expect((await ui.find({ key: 'doc:openspec/changes/a/tasks.md' }))?.props.text).toContain('1.1 Write the CSV exporter')
    await ui.press({ key: 'tab:history' })
    expect((await ui.find({ key: 'history-empty' }))?.text).toBe('No accepted revision yet.')
    await ui.unmount()
  })

  test(`${surface}: a failing check is named with its detail`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    scriptOpenspec(w)
    seedChange(w, 'a', { ...READY_FILES, 'tasks.md': `${READY_FILES['tasks.md'] ?? ''}- [ ] 1.2 Polish\n  Acceptance: x\n` })
    await boot($)
    await zboard($, 'changes a')
    const ui = await mountPane($, surface, 'zboard-changes')
    expect((await ui.find({ key: 'readiness' }))?.text).toBe('readiness ✗ coverage')
    expect((await ui.find({ key: 'check:coverage' }))?.text).toBe('✗ coverage: 1.2 names no requirement')
    await ui.unmount()
  })

  test(`${surface}: an artifact over the Markdown limit is clipped with a note instead of blanking the pane`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    scriptOpenspec(w)
    seedChange(w, 'a', { ...READY_FILES, 'design.md': `## Context\n\n${'word '.repeat(6_000)}\n` })
    await boot($)
    await zboard($, 'changes a')
    const ui = await mountPane($, surface, 'zboard-changes')
    const text = String((await ui.find({ key: 'doc:openspec/changes/a/design.md' }))?.props.text ?? '')
    expect(text.length).toBeLessThan(10_000)
    expect(text).toContain('… (truncated:')
    expect((await ui.find({ key: 'readiness' }))?.text).toBe('readiness ✓ 6/6')
    await ui.unmount()
  })
}
