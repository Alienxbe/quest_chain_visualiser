import { describe, expect, it } from 'vitest'
import { layoutView } from '../src/graph/layout'
import type { View, ViewNode } from '../src/graph/subgraph'
import type { Quest } from '../src/types'

const node = (id: string): ViewNode => ({
  id,
  quest: { id: Number(id), level: 1 } as Quest,
  external: false,
  focused: false,
  forClass: false,
})
const edge = (source: string, target: string) => ({ id: `${source}-${target}`, source, target, kind: 'requires-all' as const, chain: false })

describe('layoutView', () => {
  it('puts every quest without a prerequisite in the leftmost column', async () => {
    // 1→2→3→4, 5→4 (5 would naturally sit in layer 2), 6→7, isolated 8 and 9.
    const view: View = {
      nodes: ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(node),
      edges: [edge('1', '2'), edge('2', '3'), edge('3', '4'), edge('5', '4'), edge('6', '7')],
    }
    const p = await layoutView(view)
    for (const id of ['1', '5', '6', '8', '9']) expect(p.get(id)!.x).toBe(0)
    expect(p.get('2')!.x).toBeGreaterThan(0)
    // Components are stacked, never overlapping rows.
    const ys = ['1', '6', '8', '9'].map((id) => p.get(id)!.y)
    expect(new Set(ys).size).toBe(4)
  })
})
