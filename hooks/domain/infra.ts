// Detects infrastructure and cloud CLIs in a shell command, as command words only.
// zboard's agents work on local files and the local test command (runtime/infra-guard.ts).

export const INFRA_CLIS: readonly string[] = [
  'gcloud', 'gsutil', 'bq', 'terraform', 'tofu', 'terragrunt', 'pulumi', 'kubectl', 'helm', 'aws', 'az',
  'doctl', 'flyctl', 'heroku', 'eksctl', 'cdk', 'sam', 'serverless', 'firebase', 'vercel', 'netlify',
  'wrangler', 'ansible-playbook',
]

/** Wrappers that run the next command word, with the options of each that consume a value. */
const WRAPPERS: Readonly<Record<string, readonly string[]>> = {
  sudo: ['-u', '-g', '-h', '-p', '-C', '-r', '-t', '-U', '-D', '-R'],
  env: ['-u', '-C', '-S'],
  command: [],
  exec: ['-a'],
  xargs: ['-n', '-I', '-L', '-P', '-d', '-E', '-s', '-a', '-l', '-i'],
  nohup: [],
  time: ['-f', '-o'],
  nice: ['-n'],
  builtin: [],
  npx: ['-p', '--package'],
  bunx: ['-p', '--package'],
  pnpx: [],
}
const SHELLS: readonly string[] = ['bash', 'sh', 'zsh', 'dash', 'ksh']
const KEYWORDS: readonly string[] = ['if', 'then', 'elif', 'else', 'while', 'until', 'do', '!', '{', 'time']
const MAX_DEPTH = 6

interface Segment { readonly words: readonly string[] }
interface Scan { readonly segments: readonly Segment[]; readonly nested: readonly string[] }

function closing(text: string, from: number, open: string, close: string): number {
  let depth = 1
  for (let i = from; i < text.length; i++) {
    if (text[i] === open && open !== close) depth++
    else if (text[i] === close && --depth === 0) return i
  }
  return text.length
}

/** Splits a command into simple-command word lists, plus substitutions found inside double quotes. */
function scan(command: string): Scan {
  const segments: Segment[] = []
  const nested: string[] = []
  let words: string[] = []
  let word: string | undefined
  const endWord = () => { if (word !== undefined) words.push(word); word = undefined }
  const endSegment = () => { endWord(); if (words.length > 0) segments.push({ words }); words = [] }
  const add = (text: string) => { word = (word ?? '') + text }

  for (let i = 0; i < command.length; i++) {
    const c = command[i] ?? ''
    if (c === "'") {
      const end = command.indexOf("'", i + 1)
      add(command.slice(i + 1, end < 0 ? command.length : end))
      i = end < 0 ? command.length : end
    } else if (c === '"') {
      word ??= ''
      i++
      for (; i < command.length && command[i] !== '"'; i++) {
        const d = command[i] ?? ''
        if (d === '\\' && i + 1 < command.length) { add(command[++i] ?? ''); continue }
        if (d === '$' && command[i + 1] === '(') {
          const end = closing(command, i + 2, '(', ')')
          nested.push(command.slice(i + 2, end))
          i = end
        } else if (d === '`') {
          const end = closing(command, i + 1, '`', '`')
          nested.push(command.slice(i + 1, end))
          i = end
        } else add(d)
      }
    } else if (c === '\\' && i + 1 < command.length) {
      add(command[++i] ?? '')
    } else if (c === '`' || c === '(' || c === ')' || c === ';' || c === '|' || c === '\n') {
      endSegment()
    } else if (c === '$' && command[i + 1] === '(') {
      endSegment()
      i++
    } else if (c === '&') {
      if (command[i - 1] === '>' || command[i - 1] === '<') add(c)
      else endSegment()
    } else if (c === ' ' || c === '\t') {
      endWord()
    } else add(c)
  }
  endSegment()
  return { segments, nested }
}

const isAssignment = (word: string) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)
const isRedirect = (word: string) => /^\d*[<>]/.test(word)
const baseName = (word: string) => word.slice(word.lastIndexOf('/') + 1)

function inWords(words: readonly string[], depth: number): string | undefined {
  let i = 0
  const skipPrefix = () => {
    while (i < words.length) {
      const w = words[i] ?? ''
      if (isAssignment(w) || isRedirect(w) || KEYWORDS.includes(w)) i++
      else break
    }
  }
  skipPrefix()
  for (;;) {
    const word = words[i]
    if (word === undefined) return undefined
    const name = baseName(word)
    if (INFRA_CLIS.includes(name)) return name
    if (name === 'eval') return infraCommandOf(words.slice(i + 1).join(' '), depth + 1)
    if (SHELLS.includes(name)) {
      const flag = words.findIndex((w, k) => k > i && /^-[A-Za-z]*c[A-Za-z]*$/.test(w))
      const script = flag < 0 ? undefined : words[flag + 1]
      return script === undefined ? undefined : infraCommandOf(script, depth + 1)
    }
    const valued = WRAPPERS[name]
    if (valued === undefined) return undefined
    i++
    for (;;) {
      const next = words[i] ?? ''
      if (isAssignment(next)) i++
      else if (valued.includes(next)) i += 2
      else if (next.startsWith('-') && next.length > 1) i++
      else break
    }
  }
}

/** The infrastructure CLI the shell command runs as a command word, or undefined. */
export function infraCommandOf(command: string, depth = 0): string | undefined {
  if (depth > MAX_DEPTH) return undefined
  const { segments, nested } = scan(command)
  for (const segment of segments) {
    const found = inWords(segment.words, depth)
    if (found !== undefined) return found
  }
  for (const inner of nested) {
    const found = infraCommandOf(inner, depth + 1)
    if (found !== undefined) return found
  }
  return undefined
}
