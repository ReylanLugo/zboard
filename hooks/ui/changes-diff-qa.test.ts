import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'

import { READY_FILES, scriptOpenspec, seedChange } from '../testing/openspec.ts'
import { SURFACES, labelOf, mountPane, textsIn } from '../testing/ui.ts'
import { THEME } from './theme.ts'
import { installWorld } from '../testing/world.ts'
import { boot, json, lastAgent, scriptGit, stopAgent, zboard } from '../testing/zboard.ts'

const DESIGN = 'openspec/changes/a/design.md'
const designAnswer = (text: string) => json({ files: [{ path: DESIGN, content: text }], notes: 'tightened' })

for (const surface of SURFACES) {
  test(`${surface}: a pending proposal shows its diff; a accepts it and History lists both revisions`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    scriptOpenspec(w)
    scriptGit(w)
    seedChange(w, 'a', READY_FILES)
    await boot($)
    await zboard($, 'changes a')
    const ui = await mountPane($, surface, 'zboard-changes')
    await ui.press({ key: 'artifact:design' })
    for (const version of ['v1', 'v2']) {
      await ui.press({ key: 'comment' })
      await ui.input({ key: 'compose', text: `make it ${version}` })
      await stopAgent($, w, lastAgent(w), designAnswer(`## Context\n\n${version}\n`))
      const diff = await textsIn(ui, `diff-body:${DESIGN}`)
      expect(diff.some(line => line.text.startsWith('@@'))).toBe(true)
      expect(diff.find(line => line.text === `+${version}`)?.props.color).toBe(THEME.moss)
      expect((await ui.find({ key: 'accept' }))?.props.hotkey).toBe('a')
      await ui.press({ key: 'accept' })
    }
    expect(w.runs.filter(argv => argv[1] === 'commit').map(argv => argv[4])).toEqual(['docs(a): design rev 1', 'docs(a): design rev 2'])
    await ui.press({ key: 'tab:history' })
    expect((await ui.find({ key: 'revision:0' }))?.text).toMatch(/^design · c0ffee1 · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    expect((await ui.find({ key: 'revision:1' }))?.text).toMatch(/^design · c0ffee1 · /)
    await ui.unmount()
  })

  test(`${surface}: z rejects and writes nothing`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    scriptOpenspec(w)
    seedChange(w, 'a', READY_FILES)
    await boot($)
    await zboard($, 'changes a')
    const ui = await mountPane($, surface, 'zboard-changes')
    await ui.press({ key: 'artifact:design' })
    await ui.press({ key: 'comment' })
    await ui.input({ key: 'compose', text: 'shorter' })
    await stopAgent($, w, lastAgent(w), designAnswer('short\n'))
    expect((await ui.find({ key: 'reject' }))?.props.hotkey).toBe('z')
    await ui.press({ key: 'reject' })
    expect(w.files.get(`/repo/${DESIGN}`)).toBe(READY_FILES['design.md'])
    expect(await ui.find({ key: 'diff' })).toBeUndefined()
    await ui.unmount()
  })

  test(`${surface}: a stale proposal offers Regenerate instead of Accept`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    scriptOpenspec(w)
    seedChange(w, 'a', READY_FILES)
    await boot($)
    await zboard($, 'changes a')
    const ui = await mountPane($, surface, 'zboard-changes')
    await ui.press({ key: 'artifact:design' })
    await ui.press({ key: 'comment' })
    await ui.input({ key: 'compose', text: 'shorter' })
    await stopAgent($, w, lastAgent(w), designAnswer('short\n'))
    w.files.set(`/repo/${DESIGN}`, 'edited in the editor\n')
    await ui.press({ key: 'accept' })
    expect(w.files.get(`/repo/${DESIGN}`)).toBe('edited in the editor\n')
    expect(await ui.find({ key: 'accept' })).toBeUndefined()
    expect(await labelOf(ui, 'regenerate')).toBe('[g] regenerate')
    expect(await labelOf(ui, 'another')).toBe('[v] ask another version')
    await ui.unmount()
  })

  test(`${surface}: the Q&A view shows question, why, options, free text, Finish and earlier turns`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    scriptOpenspec(w)
    seedChange(w, 'q', {})
    await boot($)
    await zboard($, 'changes q')
    const ui = await mountPane($, surface, 'zboard-changes')
    await ui.press({ key: 'draft' })
    await stopAgent($, w, lastAgent(w), json({ question: 'Who uses it?', options: ['A', 'B'], why: 'scope' }))
    expect((await ui.find({ key: 'qa-question' }))?.text).toBe('Who uses it?')
    expect((await ui.find({ key: 'qa-why' }))?.text).toBe('scope')
    expect(await labelOf(ui, 'qa-option:1')).toBe('[2] B')
    expect(await labelOf(ui, 'qa-finish')).toBe('[f] finish')
    // Long options stack one per row instead of squeezing side by side.
    expect((await ui.find({ key: 'qa-options' }))?.props.flexDirection).toBe('column')
    await ui.press({ key: 'qa-option:1' })
    expect(w.spawns[1]?.prompt).toContain('Answer: B')
    await stopAgent($, w, lastAgent(w), json({ question: 'When?', options: [], why: 'time' }))
    expect((await ui.find({ key: 'qa-turn:0' }))?.text).toBe('Q1 Who uses it? → B')
    await ui.input({ key: 'qa-answer', text: 'next week' })
    expect(w.spawns[2]?.prompt).toContain('Answer: next week')
    await ui.unmount()
  })
}
