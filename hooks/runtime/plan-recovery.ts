import type { Io } from './io.ts'

import { fetchTopic, projectOf } from '../adapters/engram.ts'
import { isRecord, stringArray } from '../domain/json.ts'
import { VERDICTS, findingId } from '../plan/findings.ts'
import type { PlanEventBody } from '../plan/plan-events.ts'
import type { CritiqueFinding, Finding, QaSession, QaTurn, Resolution, Revision, VerifyRun } from '../plan/types.ts'
import { planTopic } from './plan-mirror.ts'
import { appendPlan, readPlan } from './plan-store.ts'

type Restored = Omit<Extract<PlanEventBody, { type: 'PlanRestored' }>, 'type' | 'changeId'>

/** D4: an active agent the engine no longer lists is interrupted; plan agents are never relaunched automatically. */
export async function recoverPlan(io: Io): Promise<void> {
  const board = await readPlan(io)
  const active = Object.values(board.changes).flatMap(rec => (rec.activeAgent === undefined ? [] : [{ changeId: rec.id, agentId: rec.activeAgent.agentId }]))
  if (active.length === 0) return
  const alive = new Set((await io.agent.list()).map(info => info.id))
  await appendPlan(io, active.filter(entry => !alive.has(entry.agentId)).map(entry => ({ type: 'PlanAgentStopped' as const, ...entry, outcome: 'interrupted' as const })))
}

const RESOLUTIONS: readonly Resolution[] = ['fix_code', 'adjust_spec', 'add_test', 'accepted']
const SEVERITIES: readonly CritiqueFinding['severity'][] = ['high', 'medium', 'low']
const RESTORED_NOTE = 'restored from the Engram mirror as true; run verify again to prove it in this session'

const isString = (value: unknown): value is string => typeof value === 'string'
const keep = <T>(items: unknown, parse: (item: Record<string, unknown>) => T | undefined): T[] =>
  (Array.isArray(items) ? items : []).filter(isRecord).flatMap(item => { const parsed = parse(item); return parsed === undefined ? [] : [parsed] })

const revisionOf = (r: Record<string, unknown>): Revision | undefined =>
  (isString(r.proposalId) && isString(r.artifact) && isString(r.commit) && typeof r.at === 'number'
    ? { proposalId: r.proposalId, artifact: r.artifact, commit: r.commit, at: r.at } : undefined)

function turnOf(t: Record<string, unknown>): QaTurn | undefined {
  const options = stringArray(t.options)
  if (!isString(t.question) || options === undefined || !isString(t.why) || (t.answer !== undefined && !isString(t.answer))) return undefined
  return { question: t.question, options, why: t.why, ...(isString(t.answer) ? { answer: t.answer } : {}) }
}

const qaOf = (qa: unknown): QaSession | undefined =>
  (isRecord(qa) && Array.isArray(qa.turns) ? { turns: keep(qa.turns, turnOf), done: qa.done === true, capped: qa.capped === true } : undefined)

function critiqueOf(c: Record<string, unknown>): CritiqueFinding | undefined {
  const severity = SEVERITIES.find(known => known === c.severity)
  if (severity === undefined || !isString(c.artifact) || !isString(c.issue) || !isString(c.suggestion)) return undefined
  return { severity, artifact: c.artifact, issue: c.issue, suggestion: c.suggestion }
}

/**
 * A restored finding is shown, never trusted: its `true` (and an accepted risk) must be proven
 * again by a verify run in this session, so it cannot pass the archive gate on the mirror's word.
 */
function findingOf(f: Record<string, unknown>): Finding | undefined {
  const verdict = VERDICTS.find(known => known === f.verdict)
  const evidence = stringArray(f.evidence)
  const scenario = isString(f.scenario) ? f.scenario : undefined
  if (!isString(f.requirement) || verdict === undefined || evidence === undefined || (f.scenario !== undefined && scenario === undefined)) return undefined
  const resolution = RESOLUTIONS.find(known => known === f.resolution && known !== 'accepted')
  return {
    id: findingId(f.requirement, scenario), requirement: f.requirement, ...(scenario === undefined ? {} : { scenario }),
    verdict: verdict === 'true' ? 'no_evidence' : verdict,
    evidence: verdict === 'true' ? [RESTORED_NOTE, ...evidence] : evidence,
    ...(resolution === undefined ? {} : { resolution }),
    ...(isString(f.linkedTask) ? { linkedTask: f.linkedTask } : {}),
  }
}

const verifyOf = (v: unknown): VerifyRun | undefined =>
  (isRecord(v) && Array.isArray(v.findings)
    ? { runs: typeof v.runs === 'number' ? v.runs : 0, findings: keep(v.findings, findingOf), passed: false } : undefined)

/** Our own mirror body; every entry is validated, and malformed ones are dropped. */
export function parseMirror(text: string | undefined): Restored | undefined {
  let value: unknown
  try {
    value = text === undefined ? undefined : JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isRecord(value)) return undefined
  const qa = qaOf(value.qa)
  const verify = verifyOf(value.verify)
  return {
    revisions: keep(value.revisions, revisionOf),
    ...(qa === undefined ? {} : { qa }),
    ...(Array.isArray(value.critique) ? { critique: keep(value.critique, critiqueOf) } : {}),
    ...(verify === undefined ? {} : { verify }),
  }
}

/** Fills Q&A, revisions, critique and findings of listed changes that have none locally (a new session). */
export async function restoreMirrors(io: Io, ids: readonly string[]): Promise<void> {
  const board = await readPlan(io)
  const project = projectOf(await io.session.root())
  const events: PlanEventBody[] = []
  for (const id of ids) {
    const rec = board.changes[id]
    const isEmpty = rec !== undefined && !rec.archived && rec.qa === undefined && rec.revisions.length === 0 && rec.critique === undefined && rec.verify === undefined
    if (!isEmpty) continue
    const restored = parseMirror((await fetchTopic(io, planTopic(project, id)))?.text)
    if (restored !== undefined) events.push({ type: 'PlanRestored', changeId: id, ...restored })
  }
  await appendPlan(io, events)
}
