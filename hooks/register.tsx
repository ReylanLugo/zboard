import type { Register } from 'claude-code'

import { installEngramAllow } from './adapters/engram.ts'
import { PLUGIN } from './runtime/ctx.ts'

const probe = { plugin: 'zboard', key: 'probe' } as const

export const register: Register = on => {
  installEngramAllow(on)
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'zboard',
      description: 'Open the zboard task board',
      argumentHint: '[run <change>[/<label>] | pause | set <label> <agent> <model> <effort> | config | import-odd <feature>]',
    })
    await $.tool.register({ name: 'board_status', description: 'Spike: answers the probe value.' })
    await $.state.set(probe, 1)
    return next(e)
  })

  on('command.run', { command: 'zboard' }, async $ => {
    const { value } = await $.state.get(probe)
    return { text: `${PLUGIN}: probe=${value ?? 'unset'}` }
  })

  on('tool.call', { tool: 'mcp__zboard__board_status' }, async $ => {
    const { value } = await $.state.get(probe)
    return { result: `probe=${value ?? 'unset'}` }
  })
}
