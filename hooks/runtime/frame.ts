// A hook's frame: open while one of zboard's hooks runs, closed once it settles.
//
// Live (Claude Code 2.1.294) the engine runs zboard's hooks for a subagent's
// events only when zboard spawned it from inside a running hook. A spawn from a
// timer callback, or from work a settled hook left behind (an `onPress` closure
// that `void`s its promise), makes every zboard hook for that agent re-entry and
// skips it: no Edit/Write guard, no comment delivery, no activity, no
// SubagentStop. The `.catch` handlers were not consulted there either. So every
// spawn must be awaited inside the hook whose ports it uses; `register.tsx`
// refuses the rest (`outsideFrame`) instead of starting an unguarded agent.

export interface Frame {
  /** The hook that opened the frame, for the refusal's message. */
  readonly hook: string
  readonly isOpen: () => boolean
}

export interface OpenFrame extends Frame {
  readonly close: () => void
}

export function openFrame(hook: string): OpenFrame {
  let isOpen = true
  return { hook, isOpen: () => isOpen, close: () => { isOpen = false } }
}

/** Runs `work` inside a frame that closes once `work` settles. */
export async function withinFrame<T>(hook: string, work: (frame: Frame) => Promise<T>): Promise<T> {
  const frame = openFrame(hook)
  try {
    return await work(frame)
  } finally {
    frame.close()
  }
}

/** Why a spawn through a settled hook's ports is refused. */
export const outsideFrame = (hook: string): string =>
  `zboard: refused a spawn outside a hook frame (the ${hook} hook had settled), which the engine would run without zboard's guard`
