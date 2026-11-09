/**
 * Builds the Map tab's data from the WoW Forever client (as served by wago.tools,
 * product "wowf"): a seamless terrain map per continent, made from the client's
 * minimap tiles, plus exact zone outlines and subzone label spots taken from the
 * area id of every terrain chunk (~33 yards).
 *
 * Writes:
 *   public/data/maps.json                         index of worlds
 *   public/data/maps/<mapId>.json                 tiles present, zones, subzones
 *   public/data/terrain/<mapId>/<z>/<x>_<y>.webp  256px tiles, zoom 0..MAX_ZOOM
 *
 * The first run downloads one terrain and one minimap file per map tile (~1 GB in
 * all). Only small derived files are cached (.cache/maps/derived/), keyed by the
 * game's file ids, which never change content, so later runs only fetch new files.
 *
 * Usage: npm run import-maps [-- --offline] [-- --build=1.60.1.70862]
 *   --offline  reuse the cached tables (files missing from the cache are still fetched)
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { decodeBlp } from './blp.ts'
import { labelPoint, outline, regionBounds, type Grid } from './mapgeo.ts'
import type { MapIndex, WorldMapData, ZoneShape } from '../src/types.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(ROOT, '.cache', 'maps')
const DERIVED = join(CACHE, 'derived')
const OUT = join(ROOT, 'public', 'data')

const WAGO = 'https://wago.tools'
const PRODUCT = 'wowf'
const HEADERS = { 'User-Agent': 'forever-quest-chains-importer' }

/** World maps (Map.db2 ids) to build: Eastern Kingdoms, Kalimdor, Zephras Isle. */
const WORLDS = [0, 1, 2991]
/** Map tiles per side of a WDT grid, and terrain chunks per side of a map tile. */
const GRID = 64
const CHUNKS = 16
/** Pixels per map tile at the most detailed zoom (one image tile per map tile). */
const TILE = 256
const MAX_ZOOM = 6 // 2^6 = 64 tiles per side
/** UiMap.Type of a zone, and the UiMap.Flags bit set on outdoor zones (not cities). */
const ZONE = 3
const FLAG_ZONE = 2
/** Subzones smaller than this many chunks get no label. */
const MIN_SUBZONE_CELLS = 4
/** Chunks whose terrain is at least this much open sea belong to no zone (the game files assign sea to zones). */
const SEA_CHUNK = 0.85
/** The minimap draws deep water almost black: at or below SEA_LIMIT it becomes transparent. */
const SEA_LIMIT = 10
const SEA_BLEND = 26

type Row = Record<string, string>

async function fetchOk(url: string): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: HEADERS })
    if (res.ok) return res
    if (attempt >= 4 || (res.status !== 429 && res.status < 500)) throw new Error(`${url}: HTTP ${res.status}`)
    await new Promise((r) => setTimeout(r, 1500 * attempt))
  }
}

async function latestBuild(offline: boolean): Promise<string> {
  const arg = process.argv.find((a) => a.startsWith('--build='))
  if (arg) return arg.slice('--build='.length)
  const file = join(CACHE, 'build.txt')
  if (offline && existsSync(file)) return (await readFile(file, 'utf8')).trim()
  const builds = (await (await fetchOk(`${WAGO}/api/builds`)).json()) as Record<string, { version: string }[]>
  const build = builds[PRODUCT]?.[0]?.version
  if (!build) throw new Error(`wago.tools has no ${PRODUCT} build`)
  await mkdir(CACHE, { recursive: true })
  await writeFile(file, build)
  return build
}

/** Parses CSV with quoted fields (names can contain commas). */
function parseCsv(text: string): Row[] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((x) => x !== '')) rows.push(row)
      row = []
    } else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const [head, ...body] = rows
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])))
}

async function loadTable(name: string, build: string, offline: boolean): Promise<Row[]> {
  const file = join(CACHE, `${name}-${build}.csv`)
  if (offline && existsSync(file)) return parseCsv(await readFile(file, 'utf8'))
  console.log(`Downloading ${name} (${build})`)
  const text = await (await fetchOk(`${WAGO}/db2/${name}/csv?build=${build}`)).text()
  if (text.startsWith('{')) throw new Error(`${name}: ${text}`)
  await mkdir(CACHE, { recursive: true })
  await writeFile(file, text)
  return parseCsv(text)
}

const download = async (fdid: number, build: string) =>
  Buffer.from(await (await fetchOk(`${WAGO}/api/casc/${fdid}?version=${build}`)).arrayBuffer())

/** Returns a derived file from the cache, or makes it from the game file and caches it. */
async function derived(name: string, make: () => Promise<Buffer>): Promise<Buffer> {
  const file = join(DERIVED, name)
  if (existsSync(file)) return readFile(file)
  const buf = await make()
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, buf)
  return buf
}

/** Iterates a chunked (IFF-style) WoW file: 4-byte reversed tag, u32 size, data. */
function* chunks(buf: Buffer): Generator<[string, Buffer]> {
  for (let i = 0; i + 8 <= buf.length;) {
    const tag = buf.toString('latin1', i, i + 4).split('').reverse().join('')
    const size = buf.readUInt32LE(i + 4)
    yield [tag, buf.subarray(i + 8, i + 8 + size)]
    i += 8 + size
  }
}

interface MapTile { col: number; row: number; root: number; minimap: number }

/** The map tiles of a world, from its WDT's MAID chunk (8 file ids per tile). */
function wdtTiles(wdt: Buffer): MapTile[] {
  for (const [tag, data] of chunks(wdt)) {
    if (tag !== 'MAID') continue
    const tiles: MapTile[] = []
    for (let k = 0; k < GRID * GRID; k++) {
      const root = data.readUInt32LE(k * 32)
      const minimap = data.readUInt32LE(k * 32 + 28)
      if (root || minimap) tiles.push({ col: k % GRID, row: Math.floor(k / GRID), root, minimap })
    }
    return tiles
  }
  throw new Error('WDT has no MAID chunk')
}

/** Area id of each of the 16×16 terrain chunks of a root ADT, row-major. */
function adtAreas(adt: Buffer): Uint32Array {
  const out = new Uint32Array(CHUNKS * CHUNKS)
  for (const [tag, data] of chunks(adt)) {
    if (tag !== 'MCNK') continue
    const ix = data.readUInt32LE(4)
    const iy = data.readUInt32LE(8)
    if (ix < CHUNKS && iy < CHUNKS) out[iy * CHUNKS + ix] = data.readUInt32LE(52)
  }
  return out
}

/** A minimap tile scaled to TILE px, with deep water made transparent (the sea shows through). */
async function terrainTile(blp: Buffer): Promise<Buffer> {
  const img = decodeBlp(blp)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const m = Math.max(d[i], d[i + 1], d[i + 2])
    if (m <= SEA_LIMIT) d[i + 3] = 0
    else if (m < SEA_BLEND) d[i + 3] = Math.round(((m - SEA_LIMIT) / (SEA_BLEND - SEA_LIMIT)) * 255)
  }
  return sharp(Buffer.from(d), { raw: { width: img.width, height: img.height, channels: 4 } })
    .resize(TILE, TILE)
    .png()
    .toBuffer()
}

/**
 * Deletes files under dir that aren't in keep (relative paths). Directories are updated
 * in place rather than recreated, so a running dev server keeps serving them.
 */
async function removeStale(dir: string, keep: Set<string>) {
  if (!existsSync(dir)) return
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    if (!keep.has(path.slice(dir.length + 1))) await rm(path)
  }
}

async function pool<T>(items: T[], limit: number, task: (item: T) => Promise<void>) {
  let next = 0
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) await task(items[next++])
  }))
}

interface Tables { map: Row[]; uiMap: Row[]; assignment: Row[]; area: Row[] }

const RAW = { width: TILE, height: TILE, channels: 4 } as const

/** Writes zoom levels MAX_ZOOM..0; each parent tile is its four children, halved. */
async function writePyramid(dir: string, z6: Map<string, Buffer>): Promise<Record<number, string[]>> {
  const present: Record<number, string[]> = {}
  const written = new Set<string>()
  let level = z6
  for (let z = MAX_ZOOM; ; z--) {
    await mkdir(join(dir, String(z)), { recursive: true })
    present[z] = [...level.keys()].sort()
    for (const k of present[z]) written.add(join(String(z), `${k}.webp`))
    await pool([...level], 8, async ([k, raw]) => {
      await sharp(raw, { raw: RAW }).webp({ quality: 80, alphaQuality: 90 }).toFile(join(dir, String(z), `${k}.webp`))
    })
    if (z === 0) {
      await removeStale(dir, written)
      return present
    }
    const parents = new Set([...level.keys()].map((k) => {
      const [x, y] = k.split('_').map(Number)
      return `${x >> 1}_${y >> 1}`
    }))
    const next = new Map<string, Buffer>()
    await pool([...parents], 8, async (k) => {
      const [x, y] = k.split('_').map(Number)
      const parts: sharp.OverlayOptions[] = []
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const child = level.get(`${2 * x + dx}_${2 * y + dy}`)
        if (child) parts.push({ input: child, raw: RAW, left: dx * TILE, top: dy * TILE })
      }
      const big = await sharp({ create: { width: TILE * 2, height: TILE * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite(parts)
        .raw()
        .toBuffer()
      next.set(k, await sharp(big, { raw: { ...RAW, width: TILE * 2, height: TILE * 2 } }).resize(TILE, TILE).raw().toBuffer())
    })
    level = next
  }
}

async function buildWorld(mapId: number, t: Tables, build: string): Promise<WorldMapData> {
  const mapRow = t.map.find((r) => r.ID === String(mapId))
  if (!mapRow) throw new Error(`Map ${mapId} not in build ${build}`)
  const name = mapRow.MapName_lang
  const tiles = wdtTiles(await download(Number(mapRow.WdtFileDataID), build))
  console.log(`${name}: ${tiles.length} map tiles`)

  // ---- every map tile: its chunks' area ids and its minimap image ----
  const size = GRID * CHUNKS
  const areaGrid = new Uint32Array(size * size)
  const z6 = new Map<string, Buffer>()
  const seaCells = new Set<number>()
  let done = 0
  await pool(tiles, 8, async (tile) => {
    if (tile.root) {
      const buf = await derived(`areas/${tile.root}.bin`, async () =>
        Buffer.from(adtAreas(await download(tile.root, build)).buffer))
      for (let iy = 0; iy < CHUNKS; iy++) {
        for (let ix = 0; ix < CHUNKS; ix++) {
          areaGrid[(tile.row * CHUNKS + iy) * size + tile.col * CHUNKS + ix] = buf.readUInt32LE((iy * CHUNKS + ix) * 4)
        }
      }
    }
    if (tile.minimap) {
      const png = await derived(`terrain/${tile.minimap}.png`, async () => terrainTile(await download(tile.minimap, build)))
      const raw = await sharp(png).ensureAlpha().raw().toBuffer()
      z6.set(`${tile.col}_${tile.row}`, raw)
      // Drop the zone of chunks that are open sea.
      const cell = TILE / CHUNKS
      for (let iy = 0; iy < CHUNKS; iy++) {
        for (let ix = 0; ix < CHUNKS; ix++) {
          let sea = 0
          for (let y = 0; y < cell; y++) {
            for (let x = 0; x < cell; x++) if (raw[((iy * cell + y) * TILE + ix * cell + x) * 4 + 3] < 128) sea++
          }
          if (sea >= cell * cell * SEA_CHUNK) seaCells.add((tile.row * CHUNKS + iy) * size + tile.col * CHUNKS + ix)
        }
      }
    }
    if (++done % 100 === 0) console.log(`  ${done}/${tiles.length}`)
  })

  const tilesPresent = await writePyramid(join(OUT, 'terrain', String(mapId)), z6)

  // ---- zones and subzones ----
  const areaRow = new Map(t.area.map((a) => [Number(a.ID), a]))
  const uiMapById = new Map(t.uiMap.map((m) => [m.ID, m]))
  // This world's zones: the zone-type UiMaps placed on it.
  const zoneMaps = new Map<number, Row>()
  for (const a of t.assignment) {
    const m = uiMapById.get(a.UiMapID)
    if (a.MapID === String(mapId) && Number(a.AreaID) && m && Number(m.Type) === ZONE) zoneMaps.set(Number(a.AreaID), m)
  }
  /** The zone (top-level area) and subzone (its direct child) an area belongs to. */
  const lineage = new Map<number, { zone: number; sub: number }>()
  const resolve = (id: number) => {
    let found = lineage.get(id)
    if (found) return found
    const chain: number[] = []
    for (let cur = id, guard = 0; cur && guard < 10; guard++) {
      chain.unshift(cur)
      cur = Number(areaRow.get(cur)?.ParentAreaID ?? 0)
    }
    found = { zone: chain[0] ?? 0, sub: chain[1] ?? 0 }
    lineage.set(id, found)
    return found
  }

  const zoneIndex = new Map([...zoneMaps.keys()].map((id, i) => [id, i + 1]))
  const subIndex = new Map<number, number>()
  const zoneGrid: Grid = { width: size, height: size, cells: new Uint32Array(size * size) }
  const subGrid: Grid = { width: size, height: size, cells: new Uint32Array(size * size) }
  const subCells = new Map<number, number>()
  for (let i = 0; i < areaGrid.length; i++) {
    if (!areaGrid[i] || seaCells.has(i)) continue
    const { zone, sub } = resolve(areaGrid[i])
    const zi = zoneIndex.get(zone)
    if (!zi) continue
    zoneGrid.cells[i] = zi
    if (sub) {
      if (!subIndex.has(sub)) subIndex.set(sub, subIndex.size + 1)
      const si = subIndex.get(sub)!
      subGrid.cells[i] = si
      subCells.set(si, (subCells.get(si) ?? 0) + 1)
    }
  }
  const zoneBounds = regionBounds(zoneGrid)
  const subBounds = regionBounds(subGrid)
  const at = (g: Grid, v: number) => (x: number, y: number) =>
    x >= 0 && y >= 0 && x < g.width && y < g.height && g.cells[y * g.width + x] === v

  const zones: ZoneShape[] = []
  for (const [areaId, m] of zoneMaps) {
    const zi = zoneIndex.get(areaId)!
    const b = zoneBounds.get(zi)
    if (!b) continue
    const subzones: ZoneShape['subzones'] = []
    for (const [sub, si] of subIndex) {
      const cells = subCells.get(si) ?? 0
      if (resolve(sub).zone !== areaId || cells < MIN_SUBZONE_CELLS) continue
      const [x, y] = labelPoint(at(subGrid, si), subBounds.get(si)!)
      subzones.push({ areaId: sub, name: areaRow.get(sub)?.AreaName_lang ?? `#${sub}`, x, y, cells })
    }
    subzones.sort((a, z) => z.cells - a.cells)
    const inside = at(zoneGrid, zi)
    const [x, y] = labelPoint(inside, b)
    zones.push({
      areaId,
      uiMapId: Number(m.ID),
      name: m.Name_lang,
      city: (Number(m.Flags) & FLAG_ZONE) === 0 || undefined,
      x,
      y,
      bounds: [b.x0, b.y0, b.x1, b.y1],
      rings: outline(inside, b),
      subzones,
    })
  }
  // Bigger zones first: labels are placed in this order.
  const area = (z: ZoneShape) => (z.bounds[2] - z.bounds[0]) * (z.bounds[3] - z.bounds[1])
  zones.sort((a, z) => area(z) - area(a))

  const cols = tiles.map((tt) => tt.col)
  const rows = tiles.map((tt) => tt.row)
  return {
    id: mapId,
    name,
    tileSize: TILE,
    maxZoom: MAX_ZOOM,
    cellSize: TILE / CHUNKS,
    tiles: tilesPresent,
    extent: [
      Math.min(...cols) * CHUNKS, Math.min(...rows) * CHUNKS,
      (Math.max(...cols) + 1) * CHUNKS, (Math.max(...rows) + 1) * CHUNKS,
    ],
    zones,
  }
}

async function main() {
  const offline = process.argv.includes('--offline')
  const build = await latestBuild(offline)
  const load = (name: string) => loadTable(name, build, offline)
  const [map, uiMap, assignment, area] = await Promise.all([load('Map'), load('UiMap'), load('UiMapAssignment'), load('AreaTable')])
  const t: Tables = { map, uiMap, assignment, area }

  await mkdir(join(OUT, 'maps'), { recursive: true })

  const index: MapIndex = {
    generatedAt: new Date().toISOString(),
    source: `World of Warcraft: Forever client ${build}, via wago.tools`,
    worlds: [],
  }
  for (const id of WORLDS) {
    const world = await buildWorld(id, t, build)
    await writeFile(join(OUT, 'maps', `${id}.json`), JSON.stringify(world))
    index.worlds.push({ id, name: world.name })
    console.log(`  ${world.zones.length} zones, ${world.zones.reduce((n, z) => n + z.subzones.length, 0)} subzones`)
  }
  // Also clears output from older versions of this script.
  await removeStale(join(OUT, 'maps'), new Set(WORLDS.map((id) => `${id}.json`)))
  await removeStale(join(OUT, 'terrain'), new Set((await Promise.all(WORLDS.map(async (id) => {
    const dir = join(OUT, 'terrain', String(id))
    return (await readdir(dir, { recursive: true })).map((f) => join(String(id), f))
  }))).flat()))
  await writeFile(join(OUT, 'maps.json'), JSON.stringify(index))
  console.log(`Wrote ${index.worlds.length} worlds to ${join(OUT, 'maps.json')}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
