export const MAX_FIELD = 4_000

/** A trimmed, non-empty string field of a tool input, or undefined. */
export function text(input: Readonly<Record<string, unknown>>, key: string, max: number = MAX_FIELD): string | undefined {
  const value = input[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' || trimmed.length > max ? undefined : trimmed
}

export const invalid = (key: string): { deny: string } => ({ deny: `zboard: invalid input: ${key} must be a non-empty string` })
