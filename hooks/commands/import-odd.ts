import type { Io } from '../runtime/io.ts'

import { fetchTopic, projectOf, saveTopic } from '../adapters/engram.ts'
import { digestOf, generateChange, isFeatureName, parseOdd, previewText } from '../adapters/odd.ts'

const DATE_LENGTH = 10

async function readSource(io: Io, feature: string): Promise<{ text: string; origin: string } | undefined> {
  const path = `odd/tasks/${feature}.md`
  const read = await io.fs.read(path).catch(() => undefined)
  const local = typeof read === 'string' ? read : undefined
  const localTime = local === undefined ? 0 : ((await io.fs.stat(path).catch(() => undefined))?.mtimeMs ?? 0)
  const remote = await fetchTopic(io, `odd/${feature}/tasks`)
  if (remote !== undefined && (local === undefined || (remote.updatedAt ?? 0) > localTime)) {
    return { text: remote.text, origin: `Engram odd/${feature}/tasks` }
  }
  return local === undefined ? undefined : { text: local, origin: path }
}

export async function importOdd(io: Io, feature: string, confirm?: string): Promise<string> {
  if (!isFeatureName(feature)) return `zboard: invalid feature name "${feature}"`
  const target = `openspec/changes/${feature}`
  if (await io.fs.exists(target)) return `zboard: ${target} already exists; nothing was written.`
  const source = await readSource(io, feature)
  if (source === undefined) return `zboard: no ODD feature ${feature} (looked for odd/tasks/${feature}.md and Engram odd/${feature}/tasks)`
  const doc = parseOdd(source.text)
  const date = new Date(await io.clock.now()).toISOString().slice(0, DATE_LENGTH)
  const generated = generateChange(feature, doc, date)
  const preview = `${previewText(feature, doc, generated)}\nSource: ${source.origin}`
  if (confirm === undefined) return preview
  if (confirm !== digestOf(generated.files)) return `zboard: the preview changed since digest ${confirm}; nothing was written.\n${preview}`
  for (const [path, text] of Object.entries(generated.files)) await io.fs.write(path, text)
  const history = JSON.stringify({ feature, tasks: generated.history })
  const saved = await saveTopic(io, `zboard/${projectOf(await io.session.root())}/${feature}/odd-history`, history)
  const count = Object.keys(generated.files).length
  return `zboard: wrote ${target} (${count} files)${saved ? '.' : '; the Route/Commit history is not in Engram (Engram unavailable).'}`
}
