import { describe, expect, it } from 'vitest'
import { labelPoint, outline, regionBounds, type Grid } from '../scripts/mapgeo'

/** Builds a grid from rows of digits (0 = empty). */
function grid(rows: string[]): Grid {
  const height = rows.length
  const width = rows[0].length
  const cells = new Uint32Array(width * height)
  rows.forEach((r, y) => [...r].forEach((c, x) => { cells[y * width + x] = Number(c) }))
  return { width, height, cells }
}
const at = (g: Grid, v: number) => (x: number, y: number) =>
  x >= 0 && y >= 0 && x < g.width && y < g.height && g.cells[y * g.width + x] === v

describe('regionBounds', () => {
  it('finds each region box, exclusive at the far end', () => {
    const g = grid(['110', '102', '002'])
    expect(regionBounds(g)).toEqual(new Map([
      [1, { x0: 0, y0: 0, x1: 2, y1: 2 }],
      [2, { x0: 2, y0: 1, x1: 3, y1: 3 }],
    ]))
  })
})

describe('outline', () => {
  it('traces a rectangle as four corners', () => {
    const g = grid(['0000', '0110', '0110', '0000'])
    const rings = outline(at(g, 1), { x0: 1, y0: 1, x1: 3, y1: 3 })
    expect(rings).toHaveLength(1)
    const pts = new Set<string>()
    for (let i = 0; i < rings[0].length; i += 2) pts.add(`${rings[0][i]},${rings[0][i + 1]}`)
    expect(pts).toEqual(new Set(['1,1', '3,1', '3,3', '1,3']))
  })

  it('gives an L shape six corners and a ring with a hole two rings', () => {
    const l = grid(['10', '11'])
    expect(outline(at(l, 1), { x0: 0, y0: 0, x1: 2, y1: 2 })[0]).toHaveLength(12)
    const ring = grid(['111', '101', '111'])
    expect(outline(at(ring, 1), { x0: 0, y0: 0, x1: 3, y1: 3 })).toHaveLength(2)
  })
})

describe('labelPoint', () => {
  it('picks the deepest cell, nearest the middle', () => {
    const g = grid(['11111', '11111', '11111', '11111', '11111'])
    expect(labelPoint(at(g, 1), { x0: 0, y0: 0, x1: 5, y1: 5 })).toEqual([2.5, 2.5])
  })

  it('stays inside a C shape instead of using its empty middle', () => {
    const g = grid(['111', '100', '111'])
    const [x, y] = labelPoint(at(g, 1), { x0: 0, y0: 0, x1: 3, y1: 3 })
    expect(at(g, 1)(Math.floor(x), Math.floor(y))).toBe(true)
  })
})
