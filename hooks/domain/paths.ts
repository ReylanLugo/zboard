const parts = (path: string): string[] => path.split('/').filter(part => part !== '')

/** Repo-relative posix path of `path` resolved lexically against `root`, or undefined outside it. */
export function normalizeInside(path: string, root: string): string | undefined {
  const spelled = path.replaceAll('\\', '/').trim()
  if (spelled === '' || spelled.includes('\0')) return undefined
  const rootParts = parts(root)
  const input = spelled.startsWith('/') ? parts(spelled) : [...rootParts, ...parts(spelled)]
  const out: string[] = []
  for (const part of input) {
    if (part === '.') continue
    if (part === '..') {
      if (out.length === 0) return undefined
      out.pop()
    } else {
      out.push(part)
    }
  }
  const isUnderRoot = out.length > rootParts.length && rootParts.every((part, index) => out[index] === part)
  return isUnderRoot ? out.slice(rootParts.length).join('/') : undefined
}
