/**
 * Geometry on an area-id grid (one cell per terrain chunk, ~33 yards): outlines and
 * label points of the regions (zones, subzones) painted on it.
 */

export interface Grid {
  width: number
  height: number
  /** One region index per cell, 0 = none. */
  cells: Uint32Array
}

export interface Bounds { x0: number; y0: number; x1: number; y1: number }

/** Bounding box (in cells, x1/y1 exclusive) of every region index present. */
export function regionBounds(g: Grid): Map<number, Bounds> {
  const out = new Map<number, Bounds>()
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      const r = g.cells[y * g.width + x]
      if (!r) continue
      const b = out.get(r)
      if (!b) out.set(r, { x0: x, y0: y, x1: x + 1, y1: y + 1 })
      else {
        if (x < b.x0) b.x0 = x
        if (y < b.y0) b.y0 = y
        if (x + 1 > b.x1) b.x1 = x + 1
        if (y + 1 > b.y1) b.y1 = y + 1
      }
    }
  }
  return out
}

/**
 * Outline of the cells where `inside` holds, as closed rings of cell-corner
 * coordinates ([x0, y0, x1, y1, ...], last point not repeated). Holes come out as
 * separate rings, so draw them with the even-odd fill rule. Collinear points are dropped.
 */
export function outline(inside: (x: number, y: number) => boolean, b: Bounds): number[][] {
  const w = b.x1 - b.x0 + 1
  const key = (x: number, y: number) => (y - b.y0) * w + (x - b.x0)
  // Directed boundary edges, keyed by start corner; clockwise on screen (y down).
  const edges = new Map<number, [number, number][]>()
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const k = key(x0, y0)
    const list = edges.get(k)
    if (list) list.push([x1, y1])
    else edges.set(k, [[x1, y1]])
  }
  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0; x < b.x1; x++) {
      if (!inside(x, y)) continue
      if (!inside(x, y - 1)) add(x, y, x + 1, y)
      if (!inside(x + 1, y)) add(x + 1, y, x + 1, y + 1)
      if (!inside(x, y + 1)) add(x + 1, y + 1, x, y + 1)
      if (!inside(x - 1, y)) add(x, y + 1, x, y)
    }
  }
  const rings: number[][] = []
  for (const [startKey, list] of edges) {
    while (list.length) {
      const sx = (startKey % w) + b.x0
      const sy = Math.floor(startKey / w) + b.y0
      const pts: number[] = [sx, sy]
      let [cx, cy] = list.pop()!
      while (cx !== sx || cy !== sy) {
        pts.push(cx, cy)
        const next = edges.get(key(cx, cy))
        if (!next?.length) break // malformed; shouldn't happen on a grid
        ;[cx, cy] = next.pop()!
      }
      const ring = dropCollinear(pts)
      if (ring.length >= 6) rings.push(ring)
    }
  }
  return rings
}

function dropCollinear(p: number[]): number[] {
  const n = p.length / 2
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const a = ((i - 1 + n) % n) * 2
    const c = ((i + 1) % n) * 2
    const bx = p[i * 2]
    const by = p[i * 2 + 1]
    const cross = (bx - p[a]) * (p[c + 1] - by) - (by - p[a + 1]) * (p[c] - bx)
    if (cross !== 0) out.push(bx, by)
  }
  return out
}

/**
 * A good label spot inside a region: the cell farthest from its edge (so the label
 * sits in the thick of it), ties going to the cell nearest the region's centroid.
 * Returns the cell's centre in cell coordinates.
 */
export function labelPoint(inside: (x: number, y: number) => boolean, b: Bounds): [number, number] {
  const w = b.x1 - b.x0
  const h = b.y1 - b.y0
  const dist = new Int32Array(w * h).fill(-1)
  const queue: number[] = []
  let sx = 0
  let sy = 0
  let n = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(b.x0 + x, b.y0 + y)) continue
      sx += x
      sy += y
      n++
      const edge = !inside(b.x0 + x - 1, b.y0 + y) || !inside(b.x0 + x + 1, b.y0 + y)
        || !inside(b.x0 + x, b.y0 + y - 1) || !inside(b.x0 + x, b.y0 + y + 1)
      if (edge) {
        dist[y * w + x] = 1
        queue.push(y * w + x)
      }
    }
  }
  if (!n) return [b.x0 + w / 2, b.y0 + h / 2]
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi]
    const x = i % w
    const y = (i - x) / w
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      const j = ny * w + nx
      if (dist[j] !== -1 || !inside(b.x0 + nx, b.y0 + ny)) continue
      dist[j] = dist[i] + 1
      queue.push(j)
    }
  }
  const cx = sx / n
  const cy = sy / n
  let best = -1
  let bestD = -1
  let bestC = Infinity
  for (let i = 0; i < dist.length; i++) {
    if (dist[i] < 0) continue
    const x = i % w
    const y = (i - x) / w
    // Cap the depth so a thick but off-centre blob doesn't beat the middle.
    const d = Math.min(dist[i], 12)
    const c = (x - cx) ** 2 + (y - cy) ** 2
    if (d > bestD || (d === bestD && c < bestC)) {
      best = i
      bestD = d
      bestC = c
    }
  }
  const x = best % w
  return [b.x0 + x + 0.5, b.y0 + (best - x) / w + 0.5]
}
