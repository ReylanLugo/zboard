import type { ParsedTask } from '../domain/events.ts'
import { unique } from '../domain/json.ts'

const SECTION = /^##\s+(\d+)\.\s+(.*?)\s*$/
const TASK = /^- \[( |x|X)\] (\d+(?:\.\d+)+)\s+(.*?)\s*$/
const CONTINUATION = /^(?: {2,}|\t)\S/
const BLOCKED = /BLOCKED on[^\n]*/
const DEPENDENCY = /\b(?:depends on|BLOCKED on)\s+(\d+(?:\.\d+)+(?:\s*(?:,|and)\s*\d+(?:\.\d+)+)*)/i
const LABEL = /\d+(?:\.\d+)+/g

export interface ParsedTasksMd {
  readonly tasks: readonly ParsedTask[]
  readonly unparsed: readonly string[]
}

export type FlipResult = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly reason: string }

interface Draft {
  readonly label: string
  readonly title: string
  readonly section: string
  readonly sectionIndex: number
  readonly done: boolean
  readonly line: string
  readonly extra: string[]
}

function finish(draft: Draft, sections: readonly (readonly string[])[]): ParsedTask {
  const description = [draft.title, ...draft.extra].join('\n')
  const explicit = DEPENDENCY.exec(description)?.[1]?.match(LABEL)
  const previous = draft.sectionIndex > 0 ? (sections[draft.sectionIndex - 1] ?? []) : []
  return {
    label: draft.label,
    title: draft.title,
    section: draft.section,
    description,
    done: draft.done,
    blockedText: BLOCKED.exec(description)?.[0]?.trim(),
    dependsOn: unique(explicit ?? previous).filter(label => label !== draft.label),
    line: draft.line,
  }
}

export function parseTasksMd(text: string): ParsedTasksMd {
  const sections: string[][] = []
  const drafts: Draft[] = []
  const unparsed: string[] = []
  let section = ''
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    const header = SECTION.exec(line)
    const task = TASK.exec(line)
    if (header !== null) {
      section = `${header[1]}. ${header[2]}`
      sections.push([])
    } else if (task !== null) {
      const label = task[2] ?? ''
      drafts.push({ label, title: task[3] ?? '', section, sectionIndex: sections.length - 1, done: task[1] !== ' ', line, extra: [] })
      sections.at(-1)?.push(label)
    } else if (CONTINUATION.test(line) && drafts.length > 0) {
      drafts.at(-1)?.extra.push(line.trim())
    } else if (line.startsWith('- [') || line.startsWith('##')) {
      unparsed.push(line)
    }
  }
  return { tasks: drafts.map(draft => finish(draft, sections)), unparsed }
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function flipLine(text: string, label: string, expectedLine: string): FlipResult {
  const lines = text.split('\n')
  const pattern = new RegExp(`^- \\[[ xX]\\] ${escapeRegExp(label)}(?:\\s|$)`)
  const index = lines.findIndex(line => pattern.test(line.replace(/\r$/, '')))
  const raw = lines[index]
  if (raw === undefined) return { ok: false, reason: `line for ${label} is missing from tasks.md` }
  if (raw.replace(/\r$/, '') !== expectedLine) return { ok: false, reason: `line for ${label} changed since it was read` }
  if (!raw.startsWith('- [ ]')) return { ok: false, reason: `${label} is already checked` }
  const flipped = `- [x]${raw.slice('- [ ]'.length)}`
  return { ok: true, text: [...lines.slice(0, index), flipped, ...lines.slice(index + 1)].join('\n') }
}
