import type { Engine } from 'claude-code/testing'

export const SURFACES = ['terminal', 'desktop'] as const
export type Surface = (typeof SURFACES)[number]

export const paneProps = (title: string) => ({
  title, isFocused: true, bodyColumns: 120, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {},
})

export const mountPane = ($: Engine, surface: Surface, requestId = 'zboard') =>
  $.ui.mount({ plugin: 'zboard', surface, component: 'Pane', requestId, props: paneProps(requestId), viewport: { columns: 160, rows: 50 } })

type Finder = { find: (query: { key: string }) => Promise<{ props: Record<string, unknown>; text: string } | undefined> }

export const labelOf = async (ui: Finder, key: string): Promise<string | undefined> => {
  const found = await ui.find({ key })
  return typeof found?.props.label === 'string' ? found.props.label : found?.text
}
