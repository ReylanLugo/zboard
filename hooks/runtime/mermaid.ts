import type { Io } from './io.ts'

import { fnv1a64 } from '../plan/hash.ts'
import type { Diagram } from '../plan/types.ts'

export const MMDC_HINT = 'npm i -g @mermaid-js/mermaid-cli'
export const MMDC_TIMEOUT_MS = 60_000
/** Rendered PNGs live outside the repository: the viewer writes nothing into the user's tree except accepted diffs. */
export const MERMAID_TMP = '/tmp/zboard-mermaid'
const PROBE_TIMEOUT_MS = 15_000
const MKDIR_TIMEOUT_MS = 10_000

let probe: Promise<boolean> | undefined

/** D12: `mmdc --version` once per module load; a hot reload probes again. */
export function hasMmdc(io: Io): Promise<boolean> {
  probe ??= io.process.run(['mmdc', '--version'], { timeoutMs: PROBE_TIMEOUT_MS }).then(out => out.exitCode === 0, () => false)
  return probe
}

export const resetMmdcProbe = (): void => {
  probe = undefined
}

async function renderSvg(io: Io, source: string): Promise<string | undefined> {
  const out = await io.process.run(['mmdc', '--input', '-', '--output', '-', '--outputFormat', 'svg'], { stdin: source, timeoutMs: MMDC_TIMEOUT_MS }).catch(() => undefined)
  return out !== undefined && out.exitCode === 0 && out.stdout.includes('<svg') ? out.stdout : undefined
}

async function renderPng(io: Io, source: string): Promise<string | undefined> {
  const file = `${MERMAID_TMP}/${fnv1a64(source)}.png`
  const made = await io.process.run(['mkdir', '-p', MERMAID_TMP], { timeoutMs: MKDIR_TIMEOUT_MS }).catch(() => undefined)
  if (made?.exitCode !== 0) return undefined
  const out = await io.process.run(['mmdc', '--input', '-', '--output', file], { stdin: source, timeoutMs: MMDC_TIMEOUT_MS }).catch(() => undefined)
  return out?.exitCode === 0 ? file : undefined
}

/** Each diagram independently: a failure leaves that one for the code-block fallback. */
export async function renderDiagrams(io: Io, diagrams: readonly Diagram[]): Promise<Diagram[]> {
  if (!(await hasMmdc(io))) return [...diagrams]
  const rendered: Diagram[] = []
  for (const diagram of diagrams) {
    const svg = await renderSvg(io, diagram.mermaid)
    const png = await renderPng(io, diagram.mermaid)
    rendered.push({ ...diagram, ...(svg === undefined ? {} : { svg }), ...(png === undefined ? {} : { png }) })
  }
  return rendered
}
