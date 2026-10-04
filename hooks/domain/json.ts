const FENCE = /```json[^\n]*\n([\s\S]*?)```/g

export function extractJson(text: string): unknown {
  const blocks = [...text.matchAll(FENCE)].map(match => match[1] ?? '')
  const candidate = blocks.length > 0 ? (blocks[blocks.length - 1] ?? '') : text.trim()
  try {
    return JSON.parse(candidate) as unknown
  } catch {
    return undefined
  }
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const stringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every(item => typeof item === 'string') ? (value as string[]) : undefined

export const unique = (items: readonly string[]): string[] => [...new Set(items)]
