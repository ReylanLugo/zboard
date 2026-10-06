const OFFSET = 0xcbf29ce484222325n
const PRIME = 0x100000001b3n
const MASK = 0xffffffffffffffffn

/** FNV-1a 64 over UTF-16 code units (equal to the byte form for ASCII). Cache and staleness only, never security (D7). */
export function fnv1a64(text: string): string {
  let hash = OFFSET
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index))
    hash = (hash * PRIME) & MASK
  }
  return hash.toString(16).padStart(16, '0')
}

export const fingerprintOf = (files: readonly { readonly path: string; readonly text: string }[]): string =>
  fnv1a64([...files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map(file => `${file.path}\u0000${file.text}\u0000`)
    .join(''))
