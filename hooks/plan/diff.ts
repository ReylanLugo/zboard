export const CONTEXT = 3

interface Op {
  readonly kind: 'eq' | 'del' | 'add'
  readonly text: string
  /** 0-based line index in the old file (for `add`, the insertion point). */
  readonly a: number
  /** 0-based line index in the new file (for `del`, the deletion point). */
  readonly b: number
}

const linesOf = (text: string | null): string[] => {
  if (text === null || text === '') return []
  const lines = text.split('\n')
  return text.endsWith('\n') ? lines.slice(0, -1) : lines
}

const prefers = (v: ReadonlyMap<number, number>, k: number, d: number): boolean =>
  k === -d || (k !== d && (v.get(k - 1) ?? 0) < (v.get(k + 1) ?? 0))

function backtrack(trace: readonly ReadonlyMap<number, number>[], a: readonly string[], b: readonly string[]): Op[] {
  const ops: Op[] = []
  let x = a.length
  let y = b.length
  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const v = trace[d] ?? new Map<number, number>()
    const k = x - y
    const prevK = prefers(v, k, d) ? k + 1 : k - 1
    const prevX = v.get(prevK) ?? 0
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      ops.push({ kind: 'eq', text: a[x - 1] ?? '', a: x - 1, b: y - 1 })
      x -= 1
      y -= 1
    }
    if (d > 0) ops.push(x === prevX ? { kind: 'add', text: b[y - 1] ?? '', a: x, b: y - 1 } : { kind: 'del', text: a[x - 1] ?? '', a: x - 1, b: y })
    x = prevX
    y = prevY
  }
  return ops.reverse()
}

/** Myers' O(ND) shortest edit script. */
function editScript(a: readonly string[], b: readonly string[]): Op[] {
  const v = new Map<number, number>([[1, 0]])
  const trace: ReadonlyMap<number, number>[] = []
  for (let d = 0; d <= a.length + b.length; d += 1) {
    trace.push(new Map(v))
    for (let k = -d; k <= d; k += 2) {
      let x = prefers(v, k, d) ? (v.get(k + 1) ?? 0) : (v.get(k - 1) ?? 0) + 1
      let y = x - k
      while (x < a.length && y < b.length && a[x] === b[y]) {
        x += 1
        y += 1
      }
      v.set(k, x)
      if (x >= a.length && y >= b.length) return backtrack(trace, a, b)
    }
  }
  return []
}

function hunk(ops: readonly Op[]): string[] {
  const olds = ops.filter(op => op.kind !== 'add')
  const news = ops.filter(op => op.kind !== 'del')
  const first = ops[0]
  const oldStart = olds.length === 0 ? (first?.a ?? 0) : (olds[0]?.a ?? 0) + 1
  const newStart = news.length === 0 ? (first?.b ?? 0) : (news[0]?.b ?? 0) + 1
  const mark = (op: Op): string => (op.kind === 'eq' ? ' ' : op.kind === 'del' ? '-' : '+')
  return [`@@ -${oldStart},${olds.length} +${newStart},${news.length} @@`, ...ops.map(op => `${mark(op)}${op.text}`)]
}

export function unifiedDiff(path: string, before: string | null, after: string, context: number = CONTEXT): string {
  const ops = editScript(linesOf(before), linesOf(after))
  const changed = ops.flatMap((op, index) => (op.kind === 'eq' ? [] : [index]))
  if (changed.length === 0) return ''
  const ranges = changed.reduce<readonly (readonly [number, number])[]>((acc, index) => {
    const start = Math.max(0, index - context)
    const end = Math.min(ops.length - 1, index + context)
    const last = acc.at(-1)
    return last !== undefined && start <= last[1] + 1 ? [...acc.slice(0, -1), [last[0], end] as const] : [...acc, [start, end] as const]
  }, [])
  const header = [`--- ${before === null ? '/dev/null' : `a/${path}`}`, `+++ b/${path}`]
  return `${[...header, ...ranges.flatMap(([start, end]) => hunk(ops.slice(start, end + 1)))].join('\n')}\n`
}
