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

type Node = { readonly type?: unknown; readonly props?: Record<string, unknown>; readonly children?: readonly unknown[] }

const descendant = (nodes: readonly unknown[], type: string): Node | undefined => {
  for (const node of nodes) {
    if (typeof node !== 'object' || node === null) continue
    const found = node as Node
    if (found.type === type) return found
    const deeper = descendant(found.children ?? [], type)
    if (deeper !== undefined) return deeper
  }
  return undefined
}

type KeyFinder = { find: (query: { key: string }) => Promise<{ children: unknown[] } | undefined> }

/**
 * The first element of `type` under the element keyed `key`. (The kit's `in` scopes
 * a search to a `Client` only, so a search inside a keyed Box walks its children.)
 */
export const findIn = async (ui: KeyFinder, key: string, type: string): Promise<{ props: Record<string, unknown> } | undefined> => {
  const scope = await ui.find({ key })
  const found = scope === undefined ? undefined : descendant(scope.children, type)
  return found === undefined ? undefined : { props: found.props ?? {} }
}

export interface FoundText { readonly text: string; readonly props: Record<string, unknown> }

const textOf = (node: Node): string =>
  (node.children ?? []).map(child => (typeof child === 'string' ? child : typeof child === 'object' && child !== null ? textOf(child as Node) : '')).join('')

const texts = (nodes: readonly unknown[]): FoundText[] =>
  nodes.flatMap(node => {
    if (typeof node !== 'object' || node === null) return []
    const found = node as Node
    return found.type === 'Text' ? [{ text: textOf(found), props: found.props ?? {} }] : texts(found.children ?? [])
  })

/** Every `Text` under the element keyed `key`, in document order, with its shown text and props (colors included). */
export const textsIn = async (ui: KeyFinder, key: string): Promise<FoundText[]> => {
  const scope = await ui.find({ key })
  return scope === undefined ? [] : texts(scope.children)
}
