import type { DomainEvent, EventBody, ParsedTask } from '../domain/events.ts'

export const CHANGE = 'demo'

export const ev = (body: EventBody, seq = 1, at = 1_000): DomainEvent => ({ ...body, seq, at, changeId: CHANGE })

export const evs = (bodies: readonly EventBody[], at = 1_000): DomainEvent[] =>
  bodies.map((body, index) => ev(body, index + 1, at + index))

export const parsed = (label: string, extra: Partial<ParsedTask> = {}): ParsedTask => ({
  label,
  title: `Task ${label}`,
  section: '1. Core',
  description: `Task ${label}`,
  done: false,
  dependsOn: [],
  line: `- [ ] ${label} Task ${label}`,
  ...extra,
})

export const loaded = (...tasks: ParsedTask[]): EventBody => ({ type: 'ChangeLoaded', tasks })

export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const inner of Object.values(value)) deepFreeze(inner)
  }
  return value
}
