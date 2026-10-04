import type { PluginOptions } from 'claude-code'

export const PLUGIN = 'zboard'
export const DEFAULT_CONCURRENCY = 3

export interface Ctx {
  readonly options: PluginOptions
}

export const concurrencyOf = (ctx: Ctx): number => {
  const value = ctx.options.concurrency
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : DEFAULT_CONCURRENCY
}
export const PANE_ID = 'zboard'
