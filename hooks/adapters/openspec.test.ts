import { expect, test } from 'claude-code/testing'

import { installWorld, worldIo } from '../testing/world.ts'
import { flipTask, isChangeName, loadChange } from './openspec.ts'

const TASKS = '## 1. Core\n\n- [ ] 1.1 Parse tasks\n- [ ] 1.2 Flip\n'
const PATH = '/repo/openspec/changes/demo/tasks.md'

test('change names are filename-safe identifiers', () => {
  expect(isChangeName('zboard-v1')).toBe(true)
  expect(isChangeName('../../etc')).toBe(false)
  expect(isChangeName('a/b')).toBe(false)
  expect(isChangeName('')).toBe(false)
})

test('loadChange reads and parses tasks.md', async ($, on) => {
  const w = installWorld(on)
  w.files.set(PATH, TASKS)
  const result = await ($ => loadChange($, 'demo'))(worldIo(w))
  expect(result).toMatchObject({ ok: true, unparsed: [], text: TASKS })
  expect((result as unknown as { tasks: { label: string }[] }).tasks.map(task => task.label)).toEqual(['1.1', '1.2'])
})

test('loadChange rejects a traversal name and a missing change', async ($, on) => {
  const w = installWorld(on)
  expect(await (async $ => [await loadChange($, '../../etc'), await loadChange($, 'nope')])(worldIo(w))).toEqual([
    { ok: false, reason: 'invalid change name: ../../etc' },
    { ok: false, reason: 'no tasks.md for change nope' },
  ])
})

test('flipTask writes the flipped line when the line is unchanged', async ($, on) => {
  const w = installWorld(on)
  w.files.set(PATH, TASKS)
  expect(await ($ => flipTask($, 'demo', '1.1', '- [ ] 1.1 Parse tasks'))(worldIo(w))).toEqual({ ok: true })
  expect(w.files.get(PATH)).toBe('## 1. Core\n\n- [x] 1.1 Parse tasks\n- [ ] 1.2 Flip\n')
})

test('flipTask writes nothing when the user edited the line', async ($, on) => {
  const w = installWorld(on)
  const edited = TASKS.replace('Parse tasks', 'Parse tasks fast')
  w.files.set(PATH, edited)
  expect(await ($ => flipTask($, 'demo', '1.1', '- [ ] 1.1 Parse tasks'))(worldIo(w))).toEqual({ ok: false, reason: 'line for 1.1 changed since it was read' })
  expect(w.files.get(PATH)).toBe(edited)
})
