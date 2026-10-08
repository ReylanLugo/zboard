import { expect, test } from 'claude-code/testing'

import { PLUGIN_TEST_TIMEOUT_MS } from '../testing/timeouts.ts'
import type { Engine } from 'claude-code/testing'

import { resetMmdcProbe } from '../runtime/mermaid.ts'
import { READY_FILES, scriptOpenspec, seedChange } from '../testing/openspec.ts'
import { SURFACES, findIn, mountPane } from '../testing/ui.ts'
import type { World } from '../testing/world.ts'
import { argvIs, installWorld } from '../testing/world.ts'
import { boot, json, lastAgent, stopAgent, zboard } from '../testing/zboard.ts'
import { THEME } from './theme.ts'

const GRAPH_TASKS = [
  '## 1. Core', '', '- [x] 1.1 Export CSV writer [req: Export CSV]', '  Acceptance: x', '',
  '## 2. UI', '', '- [ ] 2.1 Export CSV button [req: Export CSV]', '  Acceptance: x',
  '- [ ] 2.2 Export CSV dialog depends on 2.1 [req: Export CSV]', '  Acceptance: x', '',
].join('\n')
const explanation = (count: number) => json({
  overview: 'Exports CSV.', sections: [],
  diagrams: Array.from({ length: count }, (_, index) => ({ title: `D${index}`, mermaid: `graph TD; A${index}-->B${index}` })),
})

function mmdc(w: World, isAvailable: boolean, failFirstSvg = false): void {
  resetMmdcProbe()
  if (!isAvailable) {
    w.rules.push({ match: argvIs('mmdc', '--version'), answer: { exitCode: 127, stderr: 'mmdc: command not found' } })
    return
  }
  w.rules.push({ match: argvIs('mmdc', '--version'), answer: { stdout: '11.4.0\n' } }, { match: argvIs('mkdir', '-p'), answer: {} })
  if (failFirstSvg) w.rules.push({ match: argvIs('mmdc', '--input', '-', '--output', '-'), once: true, answer: { exitCode: 1, stderr: 'Parse error' } })
  w.rules.push(
    { match: argvIs('mmdc', '--input', '-', '--output', '-'), answer: { stdout: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' } },
    { match: argv => argv[0] === 'mmdc' && argv[1] === '--input' && argv[4] !== '-', answer: {} },
  )
}

async function opened(w: World, $: Engine): Promise<void> {
  scriptOpenspec(w)
  seedChange(w, 'a', { ...READY_FILES, 'tasks.md': GRAPH_TASKS })
  await boot($)
  await zboard($, 'changes a')
}

for (const surface of SURFACES) {
  test(`${surface}: the task graph is drawn per surface with one node per task and one edge per dependency`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    mmdc(w, false)
    await opened(w, $)
    const ui = await mountPane($, surface, 'zboard-changes')
    await ui.press({ key: 'tab:diagrams' })
    if (surface === 'desktop') {
      const source = String((await findIn(ui, 'task-graph', 'Svg'))?.props.source ?? '')
      expect(source.match(/<g class="node"/g)).toHaveLength(3)
      expect(source.match(/<line class="edge"/g)).toHaveLength(2)
      expect(source.match(new RegExp(`<line class="edge"[^>]*stroke="${THEME.steel}"`, 'g'))).toHaveLength(2)
      expect(source).toMatch(new RegExp(`data-task="1\\.1"><rect[^>]*fill="${THEME.moss}"[^>]*stroke="${THEME.steel}"`))
    } else {
      const source = String((await findIn(ui, 'task-graph', 'Code'))?.props.source ?? '')
      expect(source).toContain('1.1 ──▶ 2.1')
      expect(source).toContain('2.1 ──▶ 2.2')
    }
    expect(String((await findIn(ui, 'coverage', 'Code'))?.props.source)).toBe('Export CSV ← 1.1, 2.1, 2.2')
    expect(w.spawns).toEqual([])
    await ui.unmount()
  })

  test(`${surface}: without mmdc each diagram is a Mermaid code block with the install hint`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    mmdc(w, false)
    await opened(w, $)
    const ui = await mountPane($, surface, 'zboard-changes')
    await ui.press({ key: 'explain' })
    await stopAgent($, lastAgent(w), explanation(1))
    await ui.press({ key: 'tab:diagrams' })
    expect(String((await findIn(ui, 'diagram:0', 'Code'))?.props.source)).toBe('graph TD; A0-->B0')
    expect((await ui.find({ key: 'diagram-hint:0' }))?.text).toBe('Install mermaid-cli to draw this diagram: npm i -g @mermaid-js/mermaid-cli')
    await ui.press({ key: 'tab:summary' })
    expect(await ui.find({ key: 'doc:openspec/changes/a/proposal.md' })).toBeDefined()
    await ui.unmount()
  })

  test(`${surface}: with mmdc diagrams draw as Svg or Image; one failure falls back alone`, { timeoutMs: PLUGIN_TEST_TIMEOUT_MS }, async ($, on) => {
    const w = installWorld(on)
    mmdc(w, true, true)
    await opened(w, $)
    const ui = await mountPane($, surface, 'zboard-changes')
    await ui.press({ key: 'explain' })
    await stopAgent($, lastAgent(w), explanation(2))
    await ui.press({ key: 'tab:diagrams' })
    if (surface === 'desktop') {
      expect((await ui.find({ key: 'diagram-hint:0' }))?.text).toContain('npm i -g @mermaid-js/mermaid-cli')
      expect(await findIn(ui, 'diagram:1', 'Svg')).toBeDefined()
    } else {
      const images = await ui.findAll({ type: 'Image' })
      expect(images).toHaveLength(2)
      expect(images[0]?.props.source).toMatchObject({ file: expect.stringMatching(/^\/tmp\/zboard-mermaid\/[0-9a-f]{16}\.png$/), format: 'png' })
    }
    await ui.unmount()
  })
}
