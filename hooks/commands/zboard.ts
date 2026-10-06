import type { Ctx } from '../runtime/ctx.ts'
import { PANE_ID } from '../runtime/ctx.ts'
import type { Io } from '../runtime/io.ts'
import { pauseRun, startRun } from '../runtime/orchestrator.ts'
import { openChanges } from '../runtime/plan-open.ts'
import type { ZboardCommand } from './args.ts'
import { USAGE } from './args.ts'
import { setOverride, showConfig } from './config-view.ts'
import { importOdd } from './import-odd.ts'

export async function registerCommand(io: Io): Promise<void> {
  await io.command.register({
    name: 'zboard',
    description: 'Open the zboard task board and run OpenSpec changes through the pipeline',
    argumentHint: '[run <change>[/<label>] | changes [<change>] | pause | set <label> <agent> <model> <effort> | config | import-odd <feature>]',
  })
}

export async function openBoard(io: Io): Promise<string> {
  const opened = await io.ui.open({ id: PANE_ID, title: 'zboard' })
  return opened.isPlaced ? 'zboard: board opened.' : `zboard: the board waits to be placed (${opened.reason}).`
}

/** Answers one `/zboard` invocation; its hook lives in `register.tsx`. */
export async function dispatch(io: Io, ctx: Ctx, command: ZboardCommand): Promise<string> {
  switch (command.kind) {
    case 'open':
      return openBoard(io)
    case 'run': {
      const text = await startRun(io, ctx, command)
      await openBoard(io)
      return text
    }
    case 'pause':
      return pauseRun(io)
    case 'set':
      return setOverride(io, command)
    case 'config':
      return showConfig(io, ctx)
    case 'import-odd':
      return importOdd(io, command.feature, command.confirm)
    case 'changes':
      return openChanges(io, command.changeId)
    case 'error':
      return `zboard: ${command.message}`
    default:
      return `zboard: ${USAGE}`
  }
}
