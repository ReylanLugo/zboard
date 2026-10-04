export type ZboardCommand =
  | { readonly kind: 'open' }
  | { readonly kind: 'run'; readonly changeId: string; readonly label?: string }
  | { readonly kind: 'pause' }
  | { readonly kind: 'config' }
  | { readonly kind: 'set'; readonly label: string; readonly role: string; readonly model: string; readonly effort: string }
  | { readonly kind: 'import-odd'; readonly feature: string; readonly confirm?: string }
  | { readonly kind: 'error'; readonly message: string }

export const USAGE =
  'usage: /zboard [run <change>[/<label>] | pause | set <label> <agent> <model> <effort> | config | import-odd <feature> [--confirm <digest>]]'

const error = (message: string): ZboardCommand => ({ kind: 'error', message: `${message}. ${USAGE}` })

function parseRun(rest: readonly string[]): ZboardCommand {
  const parts = rest.length === 1 ? (rest[0] ?? '').split('/') : []
  const [changeId, label, extra] = parts
  if (changeId === undefined || changeId === '' || extra !== undefined || label === '') return error('run needs <change>[/<label>]')
  return label === undefined ? { kind: 'run', changeId } : { kind: 'run', changeId, label }
}

function parseSet(rest: readonly string[]): ZboardCommand {
  const [label, role, ...tail] = rest
  const effort = tail.at(-1)
  const model = tail.slice(0, -1).join(' ')
  if (label === undefined || role === undefined || effort === undefined || model === '') return error('set needs <label> <agent> <model> <effort>')
  return { kind: 'set', label, role, model, effort }
}

function parseImport(rest: readonly string[]): ZboardCommand {
  const [feature, flag, digest] = rest
  if (feature === undefined) return error('import-odd needs <feature> [--confirm <digest>]')
  if (flag === undefined) return { kind: 'import-odd', feature }
  if (flag !== '--confirm' || digest === undefined || rest.length !== 3) return error('import-odd needs <feature> [--confirm <digest>]')
  return { kind: 'import-odd', feature, confirm: digest }
}

export function parseArgs(args: string): ZboardCommand {
  const [verb, ...rest] = args.trim().split(/\s+/).filter(word => word !== '')
  switch (verb) {
    case undefined:
      return { kind: 'open' }
    case 'run':
      return parseRun(rest)
    case 'pause':
      return rest.length === 0 ? { kind: 'pause' } : error('pause takes no arguments')
    case 'config':
      return rest.length === 0 ? { kind: 'config' } : error('config takes no arguments')
    case 'set':
      return parseSet(rest)
    case 'import-odd':
      return parseImport(rest)
    default:
      return error(`unknown subcommand "${verb}"`)
  }
}
