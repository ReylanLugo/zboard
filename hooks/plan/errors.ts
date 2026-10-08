/**
 * Readable one-line forms of OpenSpec CLI failures and engine tool errors. The raw output stays on the
 * record (shown on demand); the pane draws only these lines.
 */

export const ERROR_LINE_MAX = 140
export const NO_ROOT_CODE = 'no_openspec_root'
const EMPTY = 'openspec gave no output'
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g
const MARKERS = /^[\s✖✔✗×▌•\-]+/
const ERROR_PREFIX = /^Error:\s*/
const OPENSPEC_COMMAND = /\bopenspec(?: [a-z][a-z-]*)?/
const TOOL_ERROR = /^\s*<tool_use_error>([\s\S]*?)<\/tool_use_error>\s*$/
const VALIDATION = /^InputValidationError:\s*(\[[\s\S]*\])\s*$/
const VALIDATION_LABEL = 'InputValidationError'

export interface CliIssue {
  readonly severity: string
  readonly code: string
  readonly message: string
  readonly fix?: string
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const parseObject = (text: string): Record<string, unknown> | undefined => {
  try {
    const value = JSON.parse(text) as unknown
    return isObject(value) ? value : undefined
  } catch {
    return undefined
  }
}

/** The JSON object of a CLI answer, also when stderr text follows it. */
function jsonOf(output: string): Record<string, unknown> | undefined {
  const trimmed = output.trim()
  const end = trimmed.lastIndexOf('}')
  return parseObject(trimmed) ?? (trimmed.startsWith('{') && end > 0 ? parseObject(trimmed.slice(0, end + 1)) : undefined)
}

const issueOf = (value: unknown): CliIssue[] => {
  if (!isObject(value) || typeof value.message !== 'string') return []
  const fix = typeof value.fix === 'string' ? { fix: value.fix } : {}
  return [{ severity: String(value.severity ?? 'error'), code: String(value.code ?? ''), message: value.message, ...fix }]
}

/** The `status[]` entries an OpenSpec `--json` answer reports. */
export function cliIssues(output: string | undefined): CliIssue[] {
  const status = output === undefined ? undefined : jsonOf(output)?.status
  return Array.isArray(status) ? status.flatMap(issueOf) : []
}

export const isNoOpenspecRoot = (output: string | undefined): boolean => cliIssues(output).some(issue => issue.code === NO_ROOT_CODE)

const clip = (line: string): string => (line.length <= ERROR_LINE_MAX ? line : `${line.slice(0, ERROR_LINE_MAX - 1)}…`)

/** `Run openspec init to create a root here.` → `openspec init`; any other fix is kept without its period. */
export const shortFix = (fix: string): string => OPENSPEC_COMMAND.exec(fix)?.[0] ?? fix.trim().replace(/\.$/, '')

const cleanLine = (line: string): string => line.replace(ANSI, '').replace(MARKERS, '').replace(ERROR_PREFIX, '').trim()

/** The first line naming an error, else the first non-empty one, without colour codes or markers. */
export function meaningfulLine(output: string): string {
  const lines = output.replace(ANSI, '').split('\n').map(line => line.trim()).filter(line => line !== '')
  const chosen = lines.find(line => /(^|\s)Error:/.test(line)) ?? lines[0]
  return chosen === undefined ? EMPTY : cleanLine(chosen) || EMPTY
}

const parseArray = (text: string): unknown[] | undefined => {
  try {
    const value = JSON.parse(text) as unknown
    return Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}

/** `InputValidationError: [ {path, message}, … ]` → `InputValidationError: <path> — <message>` of its first issue. */
function validationLine(body: string): string | undefined {
  const listed = VALIDATION.exec(body)?.[1]
  const first = listed === undefined ? undefined : parseArray(listed)?.[0]
  if (!isObject(first) || typeof first.message !== 'string') return undefined
  const path = Array.isArray(first.path) ? first.path.join('.') : ''
  return path === '' ? `${VALIDATION_LABEL}: ${first.message}` : `${VALIDATION_LABEL}: ${path} — ${first.message}`
}

/** An engine `<tool_use_error>` answer as one line: its first validation issue, else its text without the tags. */
function toolErrorLine(output: string): string | undefined {
  const body = TOOL_ERROR.exec(output)?.[1]?.trim()
  return body === undefined ? undefined : validationLine(body) ?? meaningfulLine(body)
}

/** One short line: `<message> · fix: <fix>` for a CLI status answer, a tool error's first issue, else the output's meaningful line. */
export function readableError(output: string): string {
  const toolError = toolErrorLine(output)
  if (toolError !== undefined) return clip(toolError)
  const issues = cliIssues(output)
  const issue = issues.find(candidate => candidate.severity === 'error') ?? issues[0]
  if (issue === undefined) return clip(meaningfulLine(output))
  return clip(issue.fix === undefined ? issue.message : `${issue.message} · fix: ${shortFix(issue.fix)}`)
}
