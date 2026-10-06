import { expect, test } from 'claude-code/testing'

import { globalLayer, parseProjectConfig, resolvePlanChoice } from './config.ts'

test('plan roles default per design D9', () => {
  expect(resolvePlanChoice('drafter', {})).toMatchObject({ model: 'opus 5.5', modelId: 'claude-opus-5-5', effort: 'high', modelSource: 'default' })
  expect(resolvePlanChoice('drafter', {}, 'tasks')).toMatchObject({ model: 'sonnet 5.5', effort: 'medium' })
  expect(resolvePlanChoice('explainer', {})).toMatchObject({ model: 'sonnet 5.5', effort: 'medium' })
  expect(resolvePlanChoice('judge', {})).toMatchObject({ model: 'opus 5.5', effort: 'high' })
})

test('.zboard/config.json configures a plan role without warnings', () => {
  const project = parseProjectConfig('{"agents":{"drafter":{"model":"sonnet 5.5","effort":"medium"}}}')
  expect(project.warnings).toEqual([])
  expect(resolvePlanChoice('drafter', { project: project.layers.drafter }))
    .toMatchObject({ model: 'sonnet 5.5', modelId: 'claude-sonnet-5-5', effort: 'medium', modelSource: 'project', effortSource: 'project' })
})

test('the settings pickers are the global layer of a plan role', () => {
  expect(globalLayer({ judgeModel: 'sonnet 5.5', judgeEffort: 'high' }, 'judge')).toEqual({ model: 'sonnet 5.5', effort: undefined })
  expect(resolvePlanChoice('judge', { global: globalLayer({ judgeModel: 'sonnet 5.5' }, 'judge') })).toMatchObject({ model: 'sonnet 5.5', modelSource: 'global' })
})
