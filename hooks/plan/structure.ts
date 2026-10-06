import type { ParsedTask } from '../domain/events.ts'

export interface GraphNode {
  readonly id: string
  readonly title: string
  readonly group: string
  readonly layer: number
  readonly order: number
  readonly done: boolean
}

export interface GraphEdge {
  readonly from: string
  readonly to: string
}

export interface TaskGraph {
  readonly nodes: readonly GraphNode[]
  readonly edges: readonly GraphEdge[]
  readonly layers: number
}

export const SVG_MAX = 131_072
const NODE_W = 160
const NODE_H = 32
const GAP_X = 60
const GAP_Y = 16
const PAD = 10
const LABEL_MAX = 22
const COLUMN_W = 28

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`)
const escapeXml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function layerOf(tasks: readonly ParsedTask[]): Map<string, number> {
  const byLabel = new Map(tasks.map(task => [task.label, task]))
  const memo = new Map<string, number>()
  const depth = (label: string, seen: ReadonlySet<string>): number => {
    const known = memo.get(label)
    if (known !== undefined) return known
    if (seen.has(label)) return 0
    const deps = (byLabel.get(label)?.dependsOn ?? []).filter(dep => byLabel.has(dep) && dep !== label)
    const value = deps.length === 0 ? 0 : Math.max(...deps.map(dep => depth(dep, new Set([...seen, label])))) + 1
    memo.set(label, value)
    return value
  }
  return new Map(tasks.map(task => [task.label, depth(task.label, new Set())]))
}

/** D12: groups fall into layers by longest path; within a layer, barycentric order of predecessors, ties by file order. */
export function layoutTasks(tasks: readonly ParsedTask[]): TaskGraph {
  const labels = new Set(tasks.map(task => task.label))
  const edges = tasks.flatMap(task => task.dependsOn.filter(dep => labels.has(dep) && dep !== task.label).map(dep => ({ from: dep, to: task.label })))
  const layers = layerOf(tasks)
  const count = tasks.length === 0 ? 0 : Math.max(...layers.values()) + 1
  const index = new Map(tasks.map((task, position) => [task.label, position]))
  const orders = Array.from({ length: count }, (_, layer) => layer).reduce<ReadonlyMap<string, number>>((placed, layer) => {
    const members = tasks.filter(task => layers.get(task.label) === layer).map(task => {
      const preds = edges.filter(edge => edge.to === task.label).flatMap(edge => { const at = placed.get(edge.from); return at === undefined ? [] : [at] })
      const center = preds.length === 0 ? Number.MAX_SAFE_INTEGER : preds.reduce((sum, at) => sum + at, 0) / preds.length
      return { label: task.label, center, position: index.get(task.label) ?? 0 }
    })
    const sorted = [...members].sort((a, b) => a.center - b.center || a.position - b.position)
    return new Map([...placed, ...sorted.map((member, order) => [member.label, order] as const)])
  }, new Map())
  const nodes = tasks.map(task => ({
    id: task.label, title: task.title, group: task.section, layer: layers.get(task.label) ?? 0, order: orders.get(task.label) ?? 0, done: task.done,
  }))
  return { nodes, edges, layers: count }
}

export function toSvg(graph: TaskGraph): string {
  const rows = Math.max(1, ...Array.from({ length: graph.layers }, (_, layer) => graph.nodes.filter(node => node.layer === layer).length))
  const width = PAD * 2 + Math.max(1, graph.layers) * NODE_W + Math.max(0, graph.layers - 1) * GAP_X
  const height = PAD * 2 + rows * NODE_H + (rows - 1) * GAP_Y
  const at = new Map(graph.nodes.map(node => [node.id, { x: PAD + node.layer * (NODE_W + GAP_X), y: PAD + node.order * (NODE_H + GAP_Y) }]))
  const lines = graph.edges.map(edge => {
    const from = at.get(edge.from) ?? { x: 0, y: 0 }
    const to = at.get(edge.to) ?? { x: 0, y: 0 }
    return `<line class="edge" data-edge="${escapeXml(`${edge.from}->${edge.to}`)}" x1="${from.x + NODE_W}" y1="${from.y + NODE_H / 2}" x2="${to.x}" y2="${to.y + NODE_H / 2}" stroke="currentColor" stroke-width="1"/>`
  })
  const boxes = graph.nodes.map(node => {
    const { x, y } = at.get(node.id) ?? { x: 0, y: 0 }
    return `<g class="node" data-task="${escapeXml(node.id)}"><rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="4" fill="none" stroke="currentColor" stroke-width="${node.done ? 2 : 1}"/>`
      + `<text x="${x + 8}" y="${y + 20}" font-size="11" font-family="monospace" fill="currentColor">${escapeXml(clip(`${node.id} ${node.title}`, LABEL_MAX))}</text></g>`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${lines.join('')}${boxes.join('')}</svg>`
}

export function toAscii(graph: TaskGraph): string {
  const columns = Array.from({ length: graph.layers }, (_, layer) =>
    graph.nodes.filter(node => node.layer === layer).sort((a, b) => a.order - b.order).map(node => `${node.done ? '■' : '□'} ${clip(`${node.id} ${node.title}`, COLUMN_W - 3)}`))
  const rows = Math.max(0, ...columns.map(column => column.length))
  const header = columns.map((_, layer) => `layer ${layer + 1}`.padEnd(COLUMN_W)).join('').trimEnd()
  const body = Array.from({ length: rows }, (_, row) => columns.map(column => (column[row] ?? '').padEnd(COLUMN_W)).join('').trimEnd())
  const edges = graph.edges.map(edge => `${edge.from} ──▶ ${edge.to}`)
  return [header, ...body, '', 'dependencies:', ...(edges.length === 0 ? ['(none)'] : edges)].join('\n')
}

export const coverageText = (covering: Readonly<Record<string, readonly string[]>>): string =>
  Object.entries(covering).map(([name, labels]) => `${name} ← ${labels.length === 0 ? 'uncovered' : labels.join(', ')}`).join('\n')
