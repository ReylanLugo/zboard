import { expect, test } from 'claude-code/testing'

import { INIT_FAILED, NO_ROOT_LIST_JSON, VALIDATE_UNKNOWN_JSON } from '../testing/openspec.ts'
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

test('empty output still reads as something', () => {
  expect(readableError('  \n ')).toBe('openspec gave no output')
})

test('only the no_openspec_root status means OpenSpec is not initialized', () => {
  expect(isNoOpenspecRoot(NO_ROOT_LIST_JSON)).toBe(true)
  expect(isNoOpenspecRoot(VALIDATE_UNKNOWN_JSON)).toBe(false)
  expect(isNoOpenspecRoot('No OpenSpec root found (as plain text)')).toBe(false)
  expect(isNoOpenspecRoot(undefined)).toBe(false)
})
