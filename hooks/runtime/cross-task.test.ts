import { expect, test } from 'claude-code/testing'

import { installWorld } from '../testing/world.ts'
import {
  ANSWERS, GREEN, RED, TASKS_PATH, TWO_TASKS, boot, json, scriptPtest, setupDemo, stopAgent, taskOf, zboard,
} from '../testing/zboard.ts'

const planFor = (file: string) => json({ approach: 'x', allowedFiles: [`src/${file}.ts`], testFiles: [`tests/${file}.test.ts`], testCases: ['keeps multiline'], edgeCases: [], risks: [] })
const tddFor = (file: string) => json({ testFiles: [`tests/${file}.test.ts`], newTests: ['keeps multiline'] })

test('a task mid-phase still passes its gate when another task closes (its commit and the tasks.md flip are not its changes)', async ($, on) => {
  const w = installWorld(on)
  const dirty = setupDemo(w, TWO_TASKS)
  scriptPtest(w, [RED, RED, GREEN, GREEN])
  await boot($)
  await zboard($, 'run demo')
  await stopAgent($, 'agent-1', ANSWERS.research)
  await stopAgent($, 'agent-2', ANSWERS.research)
  await stopAgent($, 'agent-3', planFor('a'))
  await stopAgent($, 'agent-4', planFor('b'))
  dirty.set('tests/a.test.ts', 'ta')
  await stopAgent($, 'agent-5', tddFor('a'))
  dirty.set('tests/b.test.ts', 'tb')
  await stopAgent($, 'agent-6', tddFor('b'))
  // 1.2's code phase (agent-8) is running from here on.
  dirty.set('src/a.ts', 'sa')
  await stopAgent($, 'agent-7', ANSWERS.code)
  await stopAgent($, 'agent-9', ANSWERS.approve)
  expect((await taskOf($, '1.1')).status).toBe('done')
  expect(w.files.get(TASKS_PATH)).toBe('## 1. Core\n\n- [x] 1.1 Parse tasks\n- [ ] 1.2 Flip lines\n')
  dirty.set('src/b.ts', 'sb')
  await stopAgent($, 'agent-8', ANSWERS.code)
  const task = await taskOf($, '1.2')
  expect(task.phases.at(-1)).toMatchObject({ phase: 'code', gate: 'pass' })
  expect(task.status).toBe('review')
  await stopAgent($, 'agent-10', ANSWERS.approve)
  expect(w.runs.filter(argv => argv[1] === 'commit').at(-1)).toEqual(
    ['git', 'commit', '--only', '-m', 'feat(demo): 1.2 Flip lines', '--', 'tests/b.test.ts', 'src/b.ts'],
  )
  expect((await taskOf($, '1.2')).status).toBe('done')
})
