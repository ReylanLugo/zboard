import { expect, test } from 'claude-code/testing'

import { USAGE, parseArgs } from './args.ts'

test('parses every /zboard subcommand', () => {
  expect(parseArgs('')).toEqual({ kind: 'open' })
  expect(parseArgs('run zboard-v1')).toEqual({ kind: 'run', changeId: 'zboard-v1' })
  expect(parseArgs('run zboard-v1/2.1')).toEqual({ kind: 'run', changeId: 'zboard-v1', label: '2.1' })
  expect(parseArgs('pause')).toEqual({ kind: 'pause' })
  expect(parseArgs('config')).toEqual({ kind: 'config' })
  expect(parseArgs('set 2.1 implementer opus 5.5 high')).toEqual({ kind: 'set', label: '2.1', role: 'implementer', model: 'opus 5.5', effort: 'high' })
  expect(parseArgs('import-odd parser')).toEqual({ kind: 'import-odd', feature: 'parser' })
  expect(parseArgs('import-odd parser --confirm 0a1b2c3d')).toEqual({ kind: 'import-odd', feature: 'parser', confirm: '0a1b2c3d' })
})

test('malformed arguments produce an error with usage', () => {
  expect(parseArgs('run')).toEqual({ kind: 'error', message: `run needs <change>[/<label>]. ${USAGE}` })
  expect(parseArgs('run a/b/c')).toEqual({ kind: 'error', message: `run needs <change>[/<label>]. ${USAGE}` })
  expect(parseArgs('set 2.1 implementer high')).toEqual({ kind: 'error', message: `set needs <label> <agent> <model> <effort>. ${USAGE}` })
  expect(parseArgs('import-odd parser --yes')).toEqual({ kind: 'error', message: `import-odd needs <feature> [--confirm <digest>]. ${USAGE}` })
  expect(parseArgs('dance')).toEqual({ kind: 'error', message: `unknown subcommand "dance". ${USAGE}` })
})
