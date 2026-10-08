import { expect, test } from 'claude-code/testing'

import { INIT_FAILED, NO_ROOT_LIST_JSON, VALIDATE_UNKNOWN_JSON } from '../testing/openspec.ts'
import { modelValidationError } from '../testing/world.ts'
import { ERROR_LINE_MAX, isNoOpenspecRoot, readableError } from './errors.ts'

test('a CLI status answer reads as its message and a short fix', () => {
  expect(readableError(NO_ROOT_LIST_JSON)).toBe('No OpenSpec root found from the current directory. · fix: openspec init')
})

test('a status without a fix reads as its message alone', () => {
  expect(readableError(VALIDATE_UNKNOWN_JSON)).toBe("Unknown item 'no-such-change'. Did you mean: zboard-v1, zboard-changes-viewer?")
})

test('a status answer followed by stderr still reads as its message', () => {
  expect(readableError(`${NO_ROOT_LIST_JSON}\nwarning: something on stderr`)).toBe('No OpenSpec root found from the current directory. · fix: openspec init')
})

test('plain output reads as its first non-empty line', () => {
  expect(readableError('\n\n  openspec: not an OpenSpec repository  \nsecond line\n')).toBe('openspec: not an OpenSpec repository')
})

test('an Error line wins over unrelated notices, without its colour codes and marker', () => {
  const output = `${INIT_FAILED.stdout ?? ''}\n${INIT_FAILED.stderr ?? ''}`
  expect(readableError(output)).toBe('Insufficient permissions to write to /repo')
})

test('a long line is clipped to the limit with an ellipsis', () => {
  const line = readableError(`fatal: ${'x'.repeat(400)}`)
  expect(line).toHaveLength(ERROR_LINE_MAX)
  expect(line.endsWith('…')).toBe(true)
  expect(ERROR_LINE_MAX).toBe(140)
})

test('a tool input validation error reads as its first issue path and message', () => {
  const expected = "InputValidationError: model — Invalid enum value. Expected 'sonnet' | 'opus' | 'haiku' | 'fable', received 'claude-opus-5-5'"
  expect(readableError(modelValidationError('claude-opus-5-5'))).toBe(expected)
  const oneLine = '<tool_use_error>InputValidationError: [{"code":"invalid_type","path":["prompt"],"message":"Required"},{"path":["model"],"message":"x"}]</tool_use_error>'
  expect(readableError(oneLine)).toBe('InputValidationError: prompt — Required')
})

test('a long validation message is clipped like any other line', () => {
  const line = readableError(modelValidationError('m'.repeat(400)))
  expect(line).toHaveLength(ERROR_LINE_MAX)
  expect(line.startsWith('InputValidationError: model — Invalid enum value.')).toBe(true)
})

test('any other tool error reads without its tool_use_error tags', () => {
  expect(readableError('<tool_use_error>Agent type zboard:x not found</tool_use_error>')).toBe('Agent type zboard:x not found')
})

test('empty output still reads as something', () => {
  expect(readableError('  \n ')).toBe('openspec gave no output')
})

test('only the no_openspec_root status means OpenSpec is not initialized', () => {
  expect(isNoOpenspecRoot(NO_ROOT_LIST_JSON)).toBe(true)
  expect(isNoOpenspecRoot(VALIDATE_UNKNOWN_JSON)).toBe(false)
  expect(isNoOpenspecRoot('No OpenSpec root found (as plain text)')).toBe(false)
  expect(isNoOpenspecRoot(undefined)).toBe(false)
})
