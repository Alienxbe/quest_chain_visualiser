import type { ELK as ElkInstance } from 'elkjs/lib/elk-api'
import type { View, ViewEdge, ViewNode } from './subgraph'

export const NODE_WIDTH = 240
export const NODE_HEIGHT = 64
export const GROUP_HEIGHT = 84
/** Vertical gap between stacked connected components. */
const COMPONENT_GAP = 48

let elk: Promise<ElkInstance> | null = null
/** ELK is ~1.4 MB, so it is loaded on first layout instead of with the page. */
function getElk(): Promise<ElkInstance> {
  elk ??= import('elkjs/lib/elk.bundled.js').then(({ default: ELK }) => new ELK())
  return elk
}

export type Positions = Map<string, { x: number; y: number }>

const nodeHeight = (n: ViewNode) => (n.members ? GROUP_HEIGHT : NODE_HEIGHT)

/** Splits the view into connected components, keeping the view's node order. */
export function components(nodes: ViewNode[], edges: ViewEdge[]): { nodes: ViewNode[]; edges: ViewEdge[] }[] {
  const parent = new Map(nodes.map((n) => [n.id, n.id]))
  const find = (id: string): string => {
    let root = id
    while (parent.get(root) !== root) root = parent.get(root)!
    parent.set(id, root)
    return root
  }
  for (const e of edges) {
    if (parent.has(e.source) && parent.has(e.target)) parent.set(find(e.source), find(e.target))
  }
  const byRoot = new Map<string, { nodes: ViewNode[]; edges: ViewEdge[] }>()
  for (const n of nodes) {
    const r = find(n.id)
    if (!byRoot.has(r)) byRoot.set(r, { nodes: [], edges: [] })
    byRoot.get(r)!.nodes.push(n)
  }
  for (const e of edges) {
    if (parent.has(e.source) && parent.has(e.target)) byRoot.get(find(e.source))!.edges.push(e)
  }
  return [...byRoot.values()]
}

/**
 * Left-to-right layered layout. Each connected component is laid out on its own
 * and the components are stacked vertically, so every quest without a
 * prerequisite sits in the leftmost column. Exclusive links don't influence placement.
 */
export async function layoutView(view: View): Promise<Positions> {
  const edges = view.edges.filter((e) => e.kind !== 'exclusive')
  const hasIncoming = new Set(edges.map((e) => e.target))
  const instance = await getElk()

  const laidOut = await Promise.all(
    components(view.nodes, edges).map(async (comp) => {
      if (comp.edges.length === 0) {
        const n = comp.nodes[0]
        return { positions: [{ id: n.id, x: 0, y: 0 }], height: nodeHeight(n) }
      }
      const result = await instance.layout({
        id: 'root',
        layoutOptions: {
          'elk.algorithm': 'layered',
          'elk.direction': 'RIGHT',
          'elk.padding': '[top=0,left=0,bottom=0,right=0]',
          'elk.layered.spacing.nodeNodeBetweenLayers': '70',
          'elk.spacing.nodeNode': '24',
          'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
        },
        children: comp.nodes.map((n) => ({
          id: n.id,
          width: NODE_WIDTH,
          height: nodeHeight(n),
          // Quests with no prerequisite always start in the first column.
          ...(hasIncoming.has(n.id) ? {} : { layoutOptions: { 'elk.layered.layering.layerConstraint': 'FIRST' } }),
        })),
        edges: comp.edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
      })
      const children = result.children ?? []
      const minX = Math.min(...children.map((c) => c.x ?? 0))
      const minY = Math.min(...children.map((c) => c.y ?? 0))
      const positions = children.map((c) => ({ id: c.id, x: (c.x ?? 0) - minX, y: (c.y ?? 0) - minY }))
      const height = Math.max(...children.map((c) => (c.y ?? 0) - minY + (c.height ?? NODE_HEIGHT)))
      return { positions, height }
    }),
  )

  const positions: Positions = new Map()
  let y = 0
  for (const comp of laidOut) {
    for (const p of comp.positions) positions.set(p.id, { x: p.x, y: y + p.y })
    y += comp.height + COMPONENT_GAP
  }
  return positions
}
