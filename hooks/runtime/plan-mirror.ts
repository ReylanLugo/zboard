import type { Timer } from 'claude-code'
import type { Io } from './io.ts'

import { DEBOUNCE_MS, projectOf, saveTopic } from '../adapters/engram.ts'
import type { PlanEventBody } from '../plan/plan-events.ts'
import type { ChangeRecord } from '../plan/types.ts'
import { appendPlan, onPlanAppend, readPlan, recordPlanError } from './plan-store.ts'

export const planTopic = (project: string, changeId: string): string => `zplan/${project}/${changeId}`

const MIRRORED: ReadonlySet<PlanEventBody['type']> = new Set<PlanEventBody['type']>([
  'QaAsked', 'QaAnswered', 'QaFinished', 'ProposalAccepted', 'CritiqueRecorded', 'VerifyRecorded', 'FindingResolved',
])

let dirty: ReadonlySet<string> = new Set()
let timer: Timer | undefined
let rev = 0
let isInstalled = false

/** Tests start from a clean debounce: a timer left by another test's world would otherwise swallow the next schedule. */
export function resetPlanMirror(): void {
  timer?.cancel()
  timer = undefined
  dirty = new Set()
  rev = 0
}

export const mirrorBody = (rec: ChangeRecord, revision: number, updatedAt: number): string =>
  JSON.stringify({ rev: revision, updatedAt, qa: rec.qa, revisions: rec.revisions, critique: rec.critique, verify: rec.verify })

export async function flushPlanMirror(io: Io): Promise<void> {
  timer?.cancel()
  timer = undefined
  const ids = [...dirty]
  dirty = new Set()
  if (ids.length === 0) return
  const board = await readPlan(io)
  const project = projectOf(await io.session.root())
  const now = await io.clock.now()
  const failed: string[] = []
  for (const id of ids) {
    const rec = board.changes[id]
    rev += 1
    if (rec !== undefined && !(await saveTopic(io, planTopic(project, id), mirrorBody(rec, rev, now)))) failed.push(id)
  }
  dirty = new Set([...dirty, ...failed])
  const isPending = failed.length > 0
  if (isPending !== board.mirrorPending) await appendPlan(io, [{ type: 'PlanMirrorState', pending: isPending }])
}

const changeIdOf = (event: PlanEventBody): string | undefined => ('changeId' in event ? event.changeId : undefined)

/** Debounced like the board mirror; installed once per module load. */
export function installPlanMirror(): void {
  if (isInstalled) return
  isInstalled = true
  onPlanAppend(async (io, _before, _after, events) => {
    const ids = events.filter(event => MIRRORED.has(event.type)).flatMap(event => { const id = changeIdOf(event); return id === undefined ? [] : [id] })
    if (ids.length === 0) return
    dirty = new Set([...dirty, ...ids])
    if (timer !== undefined) return
    timer = io.clock.after(DEBOUNCE_MS, () => {
      timer = undefined
      void flushPlanMirror(io).catch(error => recordPlanError(io, 'plan.mirror', error))
    })
  })
}
