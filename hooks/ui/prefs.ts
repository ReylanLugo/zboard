import type { Io } from '../runtime/io.ts'

import { isRecord } from '../domain/json.ts'
import type { Role, TaskStatus } from '../domain/types.ts'
import { ROLES, TASK_STATUSES } from '../domain/types.ts'
import type { Filter, UiState, View } from '../runtime/ui-types.ts'
import { VIEWS } from '../runtime/ui-types.ts'

export const PREFS_KEY = 'zboard/prefs'

function filterFrom(value: unknown): Filter {
  if (!isRecord(value) || typeof value.value !== 'string') return { kind: 'none' }
  if (value.kind === 'status' && (TASK_STATUSES as readonly string[]).includes(value.value)) return { kind: 'status', value: value.value as TaskStatus }
  if (value.kind === 'agent' && (ROLES as readonly string[]).includes(value.value)) return { kind: 'agent', value: value.value as Role }
  if (value.kind === 'section') return { kind: 'section', value: value.value }
  return { kind: 'none' }
}

export function prefsFrom(value: unknown): Pick<UiState, 'view' | 'filter'> | undefined {
  if (!isRecord(value) || !(VIEWS as readonly unknown[]).includes(value.view)) return undefined
  return { view: value.view as View, filter: filterFrom(value.filter) }
}

export const nextView = (view: View): View => VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length] ?? 'kanban'

/** UI preferences only: execution state never goes to io.store. */
export async function applyStoredPrefs(io: Io): Promise<void> {
  const prefs = prefsFrom(await io.store.get(PREFS_KEY))
  if (prefs !== undefined) await io.state.ui.update(ui => ({ ...ui, ...prefs }))
}
