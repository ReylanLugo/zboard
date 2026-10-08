import { expect, test } from 'claude-code/testing'

import { parseTasksMd } from '../adapters/tasks-md.ts'
import { coverageText, layoutTasks, toAscii, toSvg } from './structure.ts'

const TASKS = '## 1. Core\n\n- [x] 1.1 Parse <tasks>\n- [ ] 1.2 Flip lines\n\n## 2. UI\n\n- [ ] 2.1 Board\n- [ ] 2.2 Detail depends on 2.1\n'
const graph = () => layoutTasks(parseTasksMd(TASKS).tasks)

test('groups become layers by longest path; explicit dependencies push a task further', () => {
  expect(graph().nodes.map(node => [node.id, node.layer])).toEqual([['1.1', 0], ['1.2', 0], ['2.1', 1], ['2.2', 2]])
  expect(graph().edges).toEqual([{ from: '1.1', to: '2.1' }, { from: '1.2', to: '2.1' }, { from: '2.1', to: '2.2' }])
})

test('the layout is deterministic', () => {
  expect(graph()).toEqual(graph())
  expect(toSvg(graph())).toBe(toSvg(graph()))
  expect(toAscii(graph())).toBe(toAscii(graph()))
})

test('the SVG has one node per task and one edge per dependency, text escaped', () => {
  const svg = toSvg(graph())
  expect(svg).toStartWith('<svg xmlns="http://www.w3.org/2000/svg"')
  expect(svg.match(/<g class="node"/g)).toHaveLength(4)
  expect(svg.match(/<line class="edge"/g)).toHaveLength(3)
  expect(svg).toContain('1.1 Parse &lt;tasks&gt;')
})

test('a palette colors the SVG: nodes and edges stroked, done nodes filled', () => {
  const svg = toSvg(graph(), { line: '#7A8594', done: '#6FA36B' })
  expect(svg.match(/<line class="edge"[^>]*stroke="#7A8594"/g)).toHaveLength(3)
  expect(svg).toMatch(/data-task="1\.1"><rect[^>]*fill="#6FA36B"[^>]*stroke="#7A8594"/)
  expect(svg).toMatch(/data-task="1\.2"><rect[^>]*fill="none"[^>]*stroke="#7A8594"/)
  expect(toSvg(graph())).not.toContain('#')
})

test('the ASCII drawing lists every node and edge', () => {
  const ascii = toAscii(graph())
  for (const id of ['1.1', '1.2', '2.1', '2.2']) expect(ascii).toContain(id)
  expect(ascii).toContain('■ 1.1')
  expect(ascii).toContain('□ 1.2')
  for (const edge of ['1.1 ──▶ 2.1', '1.2 ──▶ 2.1', '2.1 ──▶ 2.2']) expect(ascii).toContain(edge)
})

test('a cyclic graph still lays out', () => {
  const cyclic = parseTasksMd('## 1. A\n\n- [ ] 1.1 A depends on 1.2\n- [ ] 1.2 B depends on 1.1\n').tasks
  expect(layoutTasks(cyclic).nodes).toHaveLength(2)
})

test('coverage text lists covering tasks and flags uncovered requirements', () => {
  expect(coverageText({ 'Export CSV': ['1.1', '2.1'], 'Import CSV': [] })).toBe('Export CSV ← 1.1, 2.1\nImport CSV ← uncovered')
})
