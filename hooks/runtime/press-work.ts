import type { Io } from './io.ts'

import { message } from './log-store.ts'

// Work a Button press or an Input submit asks for. Core runs the element's
// closure beneath zboard's `ui.press` / `ui.input` hook; the closure only queues
// its work here, and that hook runs it, awaited, with its own ports once `next(e)`
// returned. So a spawn the work makes happens inside a hook frame (runtime/frame.ts)
// and never from the drawing's ports, whose frame settled when the pane was drawn.

/** A press's work, handed the ports of the hook that runs it. */
export type PressWork = (io: Io) => Promise<void>

let queued: readonly PressWork[] = []

/** Queues a press's work for the `ui.press` / `ui.input` hook (called from the element's closure). */
export const pressWork = (work: PressWork): void => {
  queued = [...queued, work]
}

/** Runs every queued press's work in order, each awaited; one failing never stops the rest. */
export async function drainPressWork(io: Io): Promise<void> {
  while (queued.length > 0) {
    const [work, ...rest] = queued
    queued = rest
    if (work === undefined) continue
    await work(io).catch(error => io.ui.debug(`zboard: a press's work failed: ${message(error)}`))
  }
}
