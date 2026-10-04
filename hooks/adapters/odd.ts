const FEATURE = /^[a-z0-9][a-z0-9_-]{0,63}$/i
const HEADING = /^(#{1,3})\s+(.+?)\s*$/
const ODD_TASK = /^- \[( |x|X)\] T(\d+)\s*[—–-]\s*(.+)$/

export interface OddTask {
  readonly n: number
  readonly done: boolean
  readonly title: string
  readonly route?: string
  readonly commit?: string
}

export interface OddDoc {
  readonly title: string
  readonly sections: Readonly<Record<string, string>>
  readonly tasks: readonly OddTask[]
  readonly unparsed: readonly string[]
}

export interface GeneratedChange {
  readonly files: Readonly<Record<string, string>>
  readonly history: readonly { readonly label: string; readonly route?: string; readonly commit?: string }[]
}

export const isFeatureName = (name: string): boolean => FEATURE.test(name)

function oddTask(match: RegExpExecArray): OddTask {
  const rest = match[3] ?? ''
  const route = /Route:\s*([^.]+)\./.exec(rest)?.[1]?.trim()
  const commit = /Commit:\s*`([^`]+)`/.exec(rest)?.[1]
  const title = (rest.split(/\s+Route:/)[0] ?? rest).trim().replace(/\.$/, '')
  return { n: Number(match[2]), done: match[1] !== ' ', title, ...(route ? { route } : {}), ...(commit ? { commit } : {}) }
}

export function parseOdd(text: string): OddDoc {
  const lines = text.split('\n').map(line => line.replace(/\r$/, ''))
  const sections: Record<string, string[]> = {}
  const tasks: OddTask[] = []
  const unparsed: string[] = []
  let title = ''
  let current = ''
  for (const line of lines) {
    const heading = HEADING.exec(line)
    if (heading !== null) {
      if ((heading[1] ?? '').length === 1 && title === '') title = heading[2] ?? ''
      else current = (heading[2] ?? '').toLowerCase()
      continue
    }
    const isTaskSection = current.includes('task') || current.includes('checklist')
    const task = isTaskSection ? ODD_TASK.exec(line) : null
    if (task !== null) tasks.push(oddTask(task))
    else if (isTaskSection && line.startsWith('- [')) unparsed.push(line)
    else if (current !== '') sections[current] = [...(sections[current] ?? []), line]
  }
  const joined = Object.fromEntries(Object.entries(sections).map(([key, body]) => [key, body.join('\n').trim()]))
  return { title, sections: joined, tasks, unparsed }
}

const section = (doc: OddDoc, keyword: string): string =>
  Object.entries(doc.sections).find(([key]) => key.includes(keyword))?.[1] ?? ''

const paragraphs = (...parts: string[]): string => parts.filter(part => part !== '').join('\n\n') || '(not stated in the ODD feature)'

export function generateChange(feature: string, doc: OddDoc, date: string): GeneratedChange {
  const dir = `openspec/changes/${feature}`
  const proposal = [
    '## Why', '', paragraphs(section(doc, 'problem'), section(doc, 'why')), '',
    '## What Changes', '', paragraphs(section(doc, 'objective')), '',
    '## Scope', '', paragraphs(section(doc, 'scope')), '',
    '## Impact', '', `Imported from the gentle-ai ODD feature \`${feature}\` by zboard.`, '',
  ].join('\n')
  const tasks = [
    `## 1. ${doc.title || feature}`, '',
    ...doc.tasks.map(task => `- [${task.done ? 'x' : ' '}] 1.${task.n} ${task.title}`), '',
  ].join('\n')
  const design = [
    '## Context', '', `Imported from the gentle-ai ODD feature \`${feature}\`.`, '',
    '## Constraints', '', paragraphs(section(doc, 'constraint')), '',
    '## Acceptance criteria', '', paragraphs(section(doc, 'acceptance')), '',
  ].join('\n')
  return {
    files: {
      [`${dir}/.openspec.yaml`]: `schema: spec-driven\ncreated: ${date}\n`,
      [`${dir}/proposal.md`]: proposal,
      [`${dir}/tasks.md`]: tasks,
      [`${dir}/design.md`]: design,
    },
    history: doc.tasks.map(task => ({ label: `1.${task.n}`, ...(task.route ? { route: task.route } : {}), ...(task.commit ? { commit: task.commit } : {}) })),
  }
}

export function digestOf(files: Readonly<Record<string, string>>): string {
  const text = JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export function previewText(feature: string, doc: OddDoc, generated: GeneratedChange): string {
  const done = doc.tasks.filter(task => task.done).length
  return [
    `zboard import-odd ${feature} — preview (nothing written yet)`,
    'Will create:',
    ...Object.entries(generated.files).map(([path, text]) => `  ${path} (${text.split('\n').length} lines)`),
    `Tasks: ${doc.tasks.length} (${done} done)`,
    ...doc.tasks.map(task => `  - [${task.done ? 'x' : ' '}] 1.${task.n} ${task.title}`),
    ...(doc.unparsed.length === 0 ? [] : ['Unparsed lines (not imported):', ...doc.unparsed.map(line => `  ${line}`)]),
    `To write these files run: /zboard import-odd ${feature} --confirm ${digestOf(generated.files)}`,
  ].join('\n')
}
