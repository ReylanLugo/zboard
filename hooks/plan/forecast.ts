import type { Forecast } from './types.ts'

/** D10 plan step: one drafter run per `##` group of tasks.md; tokens = groups × the average recorded run. */
export function forecastOf(
  changeId: string,
  groups: readonly string[],
  choice: { readonly model: string; readonly effort?: string },
  history: readonly number[],
): Forecast {
  const runs = history.filter(tokens => Number.isFinite(tokens) && tokens > 0)
  const base: Forecast = { changeId, groups, model: choice.model, ...(choice.effort === undefined ? {} : { effort: choice.effort }) }
  if (runs.length === 0) return base
  const perRun = Math.round(runs.reduce((sum, tokens) => sum + tokens, 0) / runs.length)
  return { ...base, estimate: { perRun, low: Math.min(...runs) * groups.length, high: Math.max(...runs) * groups.length } }
}

export function forecastLines(forecast: Forecast): string[] {
  const choice = forecast.effort === undefined ? forecast.model : `${forecast.model}/${forecast.effort}`
  const estimate = forecast.estimate
  const tokens = estimate === undefined
    ? 'no estimate (no earlier drafter runs recorded)'
    : `≈ ${estimate.perRun * forecast.groups.length} tokens (${estimate.low}–${estimate.high}; ${estimate.perRun} per run)`
  return [`${forecast.groups.length} drafter run(s) · ${choice}`, tokens, ...forecast.groups.map(group => `• ${group}`)]
}
