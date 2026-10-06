import { expect, test } from 'claude-code/testing'

import { normalizeFindings } from './findings.ts'

test('evidence names the command that ran a cited test; ptest stays the default label', () => {
  const findings = normalizeFindings({
    raw: [{ requirement: 'Export CSV', verdict: 'true', evidence: ['src/export.py:3'], tests: ['tests/test_export.py', 'tests/test_other.py'] }],
    requirements: ['Export CSV'], scope: [],
    tests: {
      'tests/test_export.py': { file: 'tests/test_export.py', kind: 'pass', endLine: '=== 3 passed in 0.2s ===', command: 'uv run pytest tests/test_export.py' },
      'tests/test_other.py': { file: 'tests/test_other.py', kind: 'pass', endLine: 'ptest: demo · passed · 1 test' },
    },
    present: new Set(['src/export.py']),
  })
  expect(findings[0]?.evidence).toEqual([
    'src/export.py:3',
    'uv run pytest tests/test_export.py: === 3 passed in 0.2s ===',
    'ptest tests/test_other.py: ptest: demo · passed · 1 test',
  ])
})
