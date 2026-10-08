import type { Elements, RenderElement } from 'claude-code'

import { coveringTasks, parseRequirements } from '../plan/readiness.ts'
import { SVG_MAX, coverageText, layoutTasks, toAscii, toSvg } from '../plan/structure.ts'
import type { Diagram } from '../plan/types.ts'
import { MMDC_HINT } from '../runtime/mermaid.ts'
import { isExplanationCurrent } from '../runtime/plan-explain.ts'
import type { DetailProps } from './ChangeDetail.tsx'
import type { Els } from './els.ts'
import { THEME } from './theme.ts'

const IMAGE_ROWS = 20
const IMAGE_COLUMNS_MAX = 80

/** D12: free structural diagram — Svg on desktop, ASCII in a Code block on the terminal (and for an oversized Svg). */
function Structural(els: Els, props: DetailProps): RenderElement {
  const graph = layoutTasks(props.docs.parsedTasks)
  const svg = toSvg(graph, { line: THEME.steel, done: THEME.moss })
  if (props.surface === 'desktop' && svg.length <= SVG_MAX) {
    const { Box, Svg } = els as Elements['desktop']
    return <Box key="task-graph"><Svg source={svg} alt={`Task graph of ${props.rec.id}: ${graph.nodes.length} tasks, ${graph.edges.length} dependencies`} /></Box>
  }
  const { Box, Code } = els
  return <Box key="task-graph"><Code source={toAscii(graph)} /></Box>
}

function Rendered(els: Els, props: DetailProps, diagram: Diagram, index: number): RenderElement {
  if (props.surface === 'desktop' && diagram.svg !== undefined && diagram.svg.length <= SVG_MAX) {
    const { Svg } = els as Elements['desktop']
    return <Svg source={diagram.svg} alt={diagram.title} />
  }
  if (props.surface === 'terminal' && diagram.png !== undefined) {
    const { Image } = els as Elements['terminal']
    return <Image source={{ file: diagram.png, format: 'png' }} columns={Math.min(props.columns, IMAGE_COLUMNS_MAX)} rows={IMAGE_ROWS} alt={diagram.title} />
  }
  const { Box, Code, Text } = els
  return (
    <Box key={`diagram-fallback:${index}`} flexDirection="column">
      <Code source={diagram.mermaid} language="mermaid" />
      <Box key={`diagram-hint:${index}`}><Text dimColor>{`Install mermaid-cli to draw this diagram: ${MMDC_HINT}`}</Text></Box>
    </Box>
  )
}

export function DiagramsTab(els: Els, props: DetailProps): RenderElement {
  const { Box, Code, Text } = els
  const coverage = coverageText(coveringTasks(parseRequirements(props.docs.specs), props.docs.parsedTasks))
  const explanation = props.rec.explanation
  return (
    <Box key="tab-diagrams" flexDirection="column">
      <Box key="graph-title"><Text bold>Task graph</Text></Box>
      {Structural(els, props)}
      <Box key="coverage-title"><Text bold>Requirements ← tasks</Text></Box>
      <Box key="coverage"><Code source={coverage === '' ? 'no requirements yet' : coverage} /></Box>
      {explanation === undefined
        ? <Box key="diagrams-state"><Text dimColor>Press e to explain the change with conceptual diagrams.</Text></Box>
        : [
          <Box key="diagrams-state"><Text dimColor>{isExplanationCurrent(props.rec) ? 'conceptual diagrams · current' : 'conceptual diagrams · outdated (press e)'}</Text></Box>,
          ...explanation.value.diagrams.map((diagram, index) => (
            <Box key={`diagram:${index}`} flexDirection="column">
              <Text bold>{diagram.title}</Text>
              {Rendered(els, props, diagram, index)}
            </Box>
          )),
        ]}
    </Box>
  )
}
