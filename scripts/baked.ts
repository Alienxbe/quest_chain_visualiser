/**
 * Readers for QuestieDB's release builds: the zip archive, the "baked" database
 * stored in the addon's .toc file, and the quest XP support files.
 *
 * A baked row is stored as TOC metadata lines:
 *   ## X-Quest-<id>-S: <base64 CBOR>        scalar fields (map of field index -> value, plus a "p" mask)
 *   ## X-Quest-<id>-<field>: <base64 CBOR>  one table field
 * Long values are split into `~N~` + `-1`..`-N` chunks. See QuestieDB src/read/baked.lua.
 */
import { inflateRawSync } from 'node:zlib'

/** One entity's fields as a Lua-style row: row[fieldIndex - 1]. */
export type Row = unknown[]
export type Rows = Record<string, Row>

export interface BakedEntities {
  quests: Rows
  npcs: Rows
  objects: Rows
  items: Rows
}

// ---------------------------------------------------------------------------
// Zip

/** Extracts the files whose path matches `want` from a zip archive (stored or deflated). */
export function unzip(zip: Buffer, want: (path: string) => boolean): Map<string, Buffer> {
  // End of central directory record: last 22+ bytes, signature 0x06054b50.
  let eocd = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('Not a zip file (no end of central directory)')
  const count = zip.readUInt16LE(eocd + 10)
  let p = zip.readUInt32LE(eocd + 16)

  const out = new Map<string, Buffer>()
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt zip central directory')
    const method = zip.readUInt16LE(p + 10)
    const compressedSize = zip.readUInt32LE(p + 20)
    const nameLen = zip.readUInt16LE(p + 28)
    const extraLen = zip.readUInt16LE(p + 30)
    const commentLen = zip.readUInt16LE(p + 32)
    const localOffset = zip.readUInt32LE(p + 42)
    const path = zip.toString('utf8', p + 46, p + 46 + nameLen)
    p += 46 + nameLen + extraLen + commentLen
    if (!want(path)) continue

    const localNameLen = zip.readUInt16LE(localOffset + 26)
    const localExtraLen = zip.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + localNameLen + localExtraLen
    const data = zip.subarray(start, start + compressedSize)
    if (method === 0) out.set(path, Buffer.from(data))
    else if (method === 8) out.set(path, inflateRawSync(data))
    else throw new Error(`${path}: unsupported zip compression method ${method}`)
  }
  return out
}

// ---------------------------------------------------------------------------
// CBOR (the subset Lua's C_EncodingUtil.SerializeCBOR produces)

const utf8 = new TextDecoder('utf-8')

function halfToFloat(h: number): number {
  const exp = (h >> 10) & 0x1f
  const frac = h & 0x3ff
  const sign = h & 0x8000 ? -1 : 1
  if (exp === 0) return sign * 2 ** -14 * (frac / 1024)
  if (exp === 31) return frac ? NaN : sign * Infinity
  return sign * 2 ** (exp - 15) * (1 + frac / 1024)
}

/**
 * Decodes one CBOR value. Byte and text strings both become JS strings (Lua strings are
 * bytes). Maps become plain objects with string keys.
 */
export function decodeCbor(buf: Uint8Array): unknown {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let i = 0

  const length = (ai: number): number => {
    if (ai < 24) return ai
    if (ai === 24) return buf[i++]
    if (ai === 25) { const v = view.getUint16(i); i += 2; return v }
    if (ai === 26) { const v = view.getUint32(i); i += 4; return v }
    if (ai === 27) { const v = Number(view.getBigUint64(i)); i += 8; return v }
    throw new Error(`CBOR: unsupported length encoding ${ai}`)
  }

  const read = (): unknown => {
    const ib = buf[i++]
    const mt = ib >> 5
    const ai = ib & 31
    switch (mt) {
      case 0: return length(ai)
      case 1: return -1 - length(ai)
      case 2:
      case 3: {
        const n = length(ai)
        const s = utf8.decode(buf.subarray(i, i + n))
        i += n
        return s
      }
      case 4: {
        const n = length(ai)
        const arr: unknown[] = []
        for (let k = 0; k < n; k++) arr.push(read())
        return arr
      }
      case 5: {
        const n = length(ai)
        const obj: Record<string, unknown> = {}
        for (let k = 0; k < n; k++) {
          const key = read()
          obj[String(key)] = read()
        }
        return obj
      }
      case 6: length(ai); return read() // tag: ignore, keep the value
      case 7:
        if (ai === 20) return false
        if (ai === 21) return true
        if (ai === 22 || ai === 23) return null
        if (ai === 25) { const v = halfToFloat(view.getUint16(i)); i += 2; return v }
        if (ai === 26) { const v = view.getFloat32(i); i += 4; return v }
        if (ai === 27) { const v = view.getFloat64(i); i += 8; return v }
    }
    throw new Error(`CBOR: unsupported item 0x${ib.toString(16)}`)
  }

  return read()
}

// ---------------------------------------------------------------------------
// Baked TOC

/**
 * Turns a decoded Lua table into the shape the old Lua→JSON export produced:
 * tables whose keys are all positive integers become (possibly sparse) arrays.
 * Fields listed in `keepMaps` (e.g. spawn lists keyed by zone id) stay objects.
 */
function luaShape(v: unknown, keepMap = false): unknown {
  if (Array.isArray(v)) return v.map((x) => luaShape(x))
  if (v === null || typeof v !== 'object') return v
  const obj = v as Record<string, unknown>
  const keys = Object.keys(obj)
  if (!keepMap && keys.length && keys.every((k) => /^[1-9]\d*$/.test(k))) {
    const arr: unknown[] = []
    for (const k of keys) arr[Number(k) - 1] = luaShape(obj[k])
    for (let k = 0; k < arr.length; k++) if (arr[k] === undefined) arr[k] = null
    return arr
  }
  const out: Record<string, unknown> = {}
  for (const k of keys) out[k] = luaShape(obj[k])
  return out
}

const PREFIXES: Record<string, keyof BakedEntities> = {
  Quest: 'quests',
  Npc: 'npcs',
  Object: 'objects',
  Item: 'items',
}

/** Table fields keyed by zone id, which must stay maps: npc spawns/waypoints, object spawns/waypoints. */
const MAP_FIELDS: Partial<Record<keyof BakedEntities, Set<number>>> = {
  npcs: new Set([7, 8]),
  objects: new Set([4, 7]),
}

/** Parses every Quest/Npc/Object/Item row out of a baked QuestieDB .toc file. */
export function parseBakedToc(toc: string): BakedEntities {
  // Collect raw values first so chunked values can be reassembled.
  const values = new Map<string, string>()
  for (const line of toc.split(/\r?\n/)) {
    if (!line.startsWith('## X-')) continue
    const colon = line.indexOf(': ')
    if (colon < 0) continue
    values.set(line.slice(5, colon), line.slice(colon + 2))
  }
  const stored = (key: string): string | undefined => {
    const v = values.get(key)
    const chunks = v?.match(/^~(\d+)~$/)
    if (!chunks) return v
    let s = ''
    for (let k = 1; k <= Number(chunks[1]); k++) {
      const part = values.get(`${key}-${k}`)
      if (part === undefined) throw new Error(`Baked DB: ${key} is missing chunk ${k}`)
      s += part
    }
    return s
  }
  const decode = (key: string) => decodeCbor(Buffer.from(stored(key)!, 'base64'))

  const out: BakedEntities = { quests: {}, npcs: {}, objects: {}, items: {} }
  // Keys are <Entity>-<id>-S (scalar row) or <Entity>-<id>-<field> (table field);
  // a fourth "-N" part is a chunk of one of those and is read through stored().
  for (const key of values.keys()) {
    const m = key.match(/^(Quest|Npc|Object|Item)-(\d+)-(S|\d+)$/)
    if (!m) continue
    const kind = PREFIXES[m[1]]
    const row = (out[kind][m[2]] ??= [])
    const value = decode(key)
    if (m[3] !== 'S') {
      const f = Number(m[3])
      row[f - 1] = luaShape(value, MAP_FIELDS[kind]?.has(f))
    } else if (Array.isArray(value)) {
      value.forEach((v, k) => { row[k] ??= v })
    } else if (value && typeof value === 'object') {
      for (const [f, v] of Object.entries(value)) if (/^\d+$/.test(f)) row[Number(f) - 1] ??= v
    }
  }
  for (const rows of Object.values(out)) {
    for (const row of Object.values(rows as Rows)) {
      for (let k = 0; k < row.length; k++) if (row[k] === undefined) row[k] = null
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Quest XP

/**
 * Reads QuestieDB's QuestXP support files: `[id] = {level, xp}` entries (classic table)
 * and `QuestXP.db[id] = {level, xp}` lines (in-game traces). Later files win.
 */
export function parseQuestXp(...files: string[]): Record<number, number> {
  const xp: Record<number, number> = {}
  for (const text of files) {
    for (const m of text.matchAll(/^\s*(?:QuestXP\.db)?\[(\d+)\]\s*=\s*\{\s*-?\d+\s*,\s*(\d+)\s*\}/gm)) {
      xp[Number(m[1])] = Number(m[2])
    }
  }
  return xp
}

// ---------------------------------------------------------------------------
// Enum names

const LOWER_WORDS = new Set(['of', 'the', 'and', 'in', 'on', 'to', 'a'])

/**
 * Reads a QuestieDB correction enum (`NAME_IN_CAPS = id,` lines, e.g. zones.lua or
 * factions.lua) into id -> readable name ("KIRIN_TOR_FOREVER" -> "Kirin Tor").
 * Used only as a fallback for new Forever ids that Questie's lookups don't name yet.
 */
export function parseEnumNames(lua: string): Record<number, string> {
  const names: Record<number, string> = {}
  for (const m of lua.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(\d+)\s*,/gm)) {
    const id = Number(m[2])
    if (names[id]) continue // keep the first symbol for ids with aliases
    names[id] = m[1]
      .replace(/_FOREVER$/, '')
      .toLowerCase()
      .split('_')
      .map((w, i) => (i > 0 && LOWER_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(' ')
  }
  return names
}
