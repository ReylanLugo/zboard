import { noticesBetween } from '../domain/notices.ts'
import { onAppend } from './log-store.ts'

/**
 * Injects a notice the main model reads only for decisions and change completion.
 * The toast goes first: it is visible even where the conversation row cannot be
 * stored (Claude Code's plugin test kit has no core to keep session rows).
 */
export function installNotify(): void {
  onAppend(async (io, before, after) => {
    for (const text of noticesBetween(before, after)) {
      io.ui.toast(text)
      await io.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } })
    }
  })
}
