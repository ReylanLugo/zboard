import { readProjectConfig } from '../adapters/config-io.ts'
import { runnerOf } from '../adapters/test-runner.ts'
import { noticesBetween } from '../domain/notices.ts'
import { onAppend } from './log-store.ts'

/**
 * Injects a notice the main model reads only for decisions and change completion.
 * The toast goes first: it is visible even where the conversation row cannot be
 * stored (Claude Code's plugin test kit has no core to keep session rows).
 * The project config is read only when there is something to say, so routine
 * appends cost no extra read; its runner decides the full-suite wording.
 */
export function installNotify(): void {
  onAppend(async (io, before, after) => {
    if (noticesBetween(before, after).length === 0) return
    const runner = runnerOf(await readProjectConfig(io)).kind
    for (const text of noticesBetween(before, after, runner)) {
      io.ui.toast(text)
      await io.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } })
    }
  })
}
