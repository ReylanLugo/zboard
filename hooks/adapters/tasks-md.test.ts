import { expect, test } from 'claude-code/testing'

import { flipLine, parseTasksMd } from './tasks-md.ts'

const SAMPLE = [
  '## 1. Core',
  '',
  '- [x] 1.1 Parse tasks',
  '- [ ] 1.2 Write the flip',
  '  continues on a second line',
  '  and a third',
  '',
  '## 2. Pipeline',
  '',
  '- [ ] 2.1 Spawn agents BLOCKED on 1.2',
  '- [ ] 2.2 Gates depends on 2.1 and 1.1',
  '- [ ] 2.3 Commit',
  '- [ ] Fix things without a label',
  '',
].join('\n')

test('parses sections, labels, done-state and titles', () => {
  const { tasks } = parseTasksMd(SAMPLE)
  expect(tasks.map(task => [task.label, task.done, task.section])).toEqual([
    ['1.1', true, '1. Core'],
    ['1.2', false, '1. Core'],
    ['2.1', false, '2. Pipeline'],
    ['2.2', false, '2. Pipeline'],
    ['2.3', false, '2. Pipeline'],
  ])
  expect(tasks[0]?.title).toBe('Parse tasks')
  expect(tasks[0]?.line).toBe('- [x] 1.1 Parse tasks')
})

test('continuation text belongs to the task description', () => {
  const task = parseTasksMd(SAMPLE).tasks[1]
  expect(task?.description).toBe('Write the flip\ncontinues on a second line\nand a third')
})

test('inline BLOCKED text is recorded and becomes the dependency', () => {
  const task = parseTasksMd(SAMPLE).tasks[2]
  expect(task?.blockedText).toBe('BLOCKED on 1.2')
  expect(task?.dependsOn).toEqual(['1.2'])
})

test('explicit "depends on" wins; otherwise a task depends on the previous section', () => {
  const { tasks } = parseTasksMd(SAMPLE)
  expect(tasks[3]?.dependsOn).toEqual(['2.1', '1.1'])
  expect(tasks[4]?.dependsOn).toEqual(['1.1', '1.2'])
  expect(tasks[0]?.dependsOn).toEqual([])
})

test('a checkbox line without a label is reported as unparsed', () => {
  expect(parseTasksMd(SAMPLE).unparsed).toEqual(['- [ ] Fix things without a label'])
})

test('flips only the exact line and keeps every other byte', () => {
  const flipped = flipLine(SAMPLE, '1.2', '- [ ] 1.2 Write the flip')
  expect(flipped).toEqual({ ok: true, text: SAMPLE.replace('- [ ] 1.2 Write the flip', '- [x] 1.2 Write the flip') })
})

test('refuses when the line changed since it was read, or is missing', () => {
  expect(flipLine(SAMPLE, '1.2', '- [ ] 1.2 Write the flip carefully')).toEqual({ ok: false, reason: 'line for 1.2 changed since it was read' })
  expect(flipLine(SAMPLE, '9.9', '- [ ] 9.9 Gone')).toEqual({ ok: false, reason: 'line for 9.9 is missing from tasks.md' })
})

test('flips a CRLF line and keeps every other byte', () => {
  const crlf = SAMPLE.replaceAll('\n', '\r\n')
  const { tasks } = parseTasksMd(crlf)
  expect(tasks[1]?.line).toBe('- [ ] 1.2 Write the flip')
  const flipped = flipLine(crlf, '1.2', '- [ ] 1.2 Write the flip')
  expect(flipped).toEqual({ ok: true, text: crlf.replace('- [ ] 1.2 Write the flip\r\n', '- [x] 1.2 Write the flip\r\n') })
})

test('flip targets the exact label, not a prefix', () => {
  const text = '## 1. A\n\n- [ ] 1.10 Tenth\n- [ ] 1.1 First\n'
  expect(flipLine(text, '1.1', '- [ ] 1.1 First')).toEqual({ ok: true, text: '## 1. A\n\n- [ ] 1.10 Tenth\n- [x] 1.1 First\n' })
})
