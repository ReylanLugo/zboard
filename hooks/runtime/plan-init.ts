import type { Io } from './io.ts'

import { SCHEMA, hasPreferredSchema, initCli } from '../adapters/openspec-cli.ts'
import { refreshChanges } from './plan-catalog.ts'
import { serialized } from './plan-runner.ts'

export const OPENSPEC_CONFIG = 'openspec/config.yaml'
const SCHEMA_LINE = /^schema:.*$/m

const setInitError = (io: Io, initError: string | null): Promise<unknown> =>
  io.state.ui.update(ui => ({ ...ui, changes: { ...ui.changes, initError } }))

/** Points the project at superpowers-bridge, replacing only the `schema:` line. */
async function preferBridgeSchema(io: Io): Promise<void> {
  if (!(await hasPreferredSchema(io))) return
  const text = await io.fs.read(OPENSPEC_CONFIG)
  if (!SCHEMA_LINE.test(text)) return
  await io.fs.write(OPENSPEC_CONFIG, text.replace(SCHEMA_LINE, `schema: ${SCHEMA}`))
}

async function initialize(io: Io): Promise<void> {
  if (await io.fs.exists(OPENSPEC_CONFIG)) return
  const ran = await initCli(io)
  if (!ran.ok) {
    await setInitError(io, ran.output)
    io.ui.invalidate()
    return
  }
  await setInitError(io, null)
  await preferBridgeSchema(io)
  await refreshChanges(io)
}

/**
 * The viewer's `i` on a folder without OpenSpec. Serialized so two presses before the
 * redraw initialize once: the second sees `openspec/config.yaml` and does nothing. Without
 * superpowers-bridge the project keeps openspec's default schema, and new changes use it too.
 */
export async function initOpenspec(io: Io): Promise<void> {
  const root = await io.session.root()
  await serialized(`openspec-init:${root}`, () => initialize(io))
}
