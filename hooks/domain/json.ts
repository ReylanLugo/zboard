/** A ```json opening line (any case; an info string may follow a space, so ```jsonc and ```json5 are not json). */
const OPENER = /```json(?:[ \t][^\n]*)?\r?\n/gi
const CLOSER = '```'

/** The body of the last json fence: undefined when there is none, null when that last fence is unterminated. */
function lastJsonFence(text: string): string | null | undefined {
  const opener = new RegExp(OPENER)
  let body: string | undefined
  for (let open = opener.exec(text); open !== null; open = opener.exec(text)) {
    const start = open.index + open[0].length
    const end = text.indexOf(CLOSER, start)
    if (end === -1) return null
    body = text.slice(start, end)
    opener.lastIndex = end + CLOSER.length
  }
  return body
}

/** The last json fence decides; if it is unterminated or malformed there is no JSON (never an earlier block). */
export function extractJson(text: string): unknown {
  const fence = lastJsonFence(text)
  if (fence === null) return undefined
  try {
    return JSON.parse(fence ?? text.trim()) as unknown
  } catch {
    return undefined
  }
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const stringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every(item => typeof item === 'string') ? (value as string[]) : undefined

export const unique = (items: readonly string[]): string[] => [...new Set(items)]
