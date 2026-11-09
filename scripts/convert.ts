import { LuaFactory } from 'wasmoon'
import type { Dungeon, Faction, Quest, QuestDb } from '../src/types.ts'

/** Raw Lua source files from Questie. */
export interface RawSources {
  quests: string
  npcs: string
  objects: string
  items: string
  zones: string
  categories: string
}

/** An NPC or object: its name, main zone and every zone it spawns in. */
interface Place {
  name: string
  zone?: number
  zones?: number[]
  /** NPCs only. */
  minLevel?: number
  maxLevel?: number
  rank?: number
  /** NPCs only: "A", "H", "AH", or absent when hostile to both. */
  friendly?: string
}

/** Shape produced by EXTRACT_LUA (see below). */
interface Extracted {
  quests: RawQuest[]
  npcs: Record<string, Place>
  objects: Record<string, Place>
  items: Record<string, { name: string; npcDrops?: number[]; objectDrops?: number[] }>
  zones: Record<string, string>
  categories: Record<string, string>
  /** Area ids Questie files under dungeons & raids (zoneCategoryLookup[9]). */
  dungeonIds: number[]
}

interface RawQuest {
  id: number
  name?: string
  startedBy?: (number[] | null)[]
  finishedBy?: (number[] | null)[]
  /** [creatures, objects, items, reputation, killCredit, spells]. */
  objectives?: unknown[]
  requiredSourceItems?: number[]
  requiredLevel?: number
  questLevel?: number
  requiredRaces?: number
  requiredClasses?: number
  objectivesText?: string[]
  preQuestGroup?: number[]
  preQuestSingle?: number[]
  childQuests?: number[]
  exclusiveTo?: number[]
  zoneOrSort?: number
  specialFlags?: number
  parentQuest?: number
  breadcrumbForQuestId?: number
  breadcrumbs?: number[]
  availableStartingWith?: number
}

/** Stubs for the addon environment so the Questie files can run outside the game. */
const PRELUDE_LUA = `
local modules = {
  Expansions = { Current = 1, Era = 1, Tbc = 2, Wotlk = 3, Cata = 4, MoP = 5 },
}
QuestieLoader = {
  ImportModule = function(_, name)
    modules[name] = modules[name] or {}
    return modules[name]
  end,
}
__modules = modules
`

/**
 * Runs inside Lua after all data files are loaded. Picks the fields we need,
 * looking up field positions by name from the DB's own *Keys tables,
 * and returns everything as one JSON string.
 */
const EXTRACT_LUA = `
local QuestieDB = __modules.QuestieDB
local l10n = __modules.l10n

local function enc(v)
  local t = type(v)
  if t == 'nil' then return 'null'
  elseif t == 'boolean' then return tostring(v)
  elseif t == 'number' then
    if math.type(v) == 'integer' then return string.format('%d', v) end
    if v ~= v or v == math.huge or v == -math.huge then return 'null' end
    return string.format('%.14g', v)
  elseif t == 'string' then
    local s = v:gsub('[%c"\\\\]', function(c)
      if c == '"' then return '\\\\"' end
      if c == '\\\\' then return '\\\\\\\\' end
      if c == '\\n' then return '\\\\n' end
      return string.format('\\\\u%04x', c:byte())
    end)
    return '"' .. s .. '"'
  elseif t == 'table' then
    local maxn, isArray = 0, true
    for k in pairs(v) do
      if math.type(k) == 'integer' and k > 0 then
        if k > maxn then maxn = k end
      else
        isArray = false
      end
    end
    local parts = {}
    if isArray then
      for i = 1, maxn do parts[i] = enc(v[i]) end
      return '[' .. table.concat(parts, ',') .. ']'
    end
    for k, val in pairs(v) do
      parts[#parts + 1] = enc(tostring(k)) .. ':' .. enc(val)
    end
    return '{' .. table.concat(parts, ',') .. '}'
  end
  return 'null'
end

local QK = QuestieDB.questKeys
local wanted = {
  'name', 'startedBy', 'finishedBy', 'objectives', 'requiredSourceItems', 'requiredLevel', 'questLevel', 'requiredRaces', 'requiredClasses',
  'objectivesText', 'preQuestGroup', 'preQuestSingle', 'childQuests', 'exclusiveTo',
  'zoneOrSort', 'specialFlags', 'parentQuest', 'breadcrumbForQuestId', 'breadcrumbs',
  'availableStartingWith',
}
local quests = {}
for id, q in pairs(load(QuestieDB.questData)()) do
  local out = { id = id }
  for _, key in ipairs(wanted) do
    if QK[key] then out[key] = q[QK[key]] end
  end
  quests[#quests + 1] = out
end

-- Name, main zone and the list of zones an NPC/object spawns in.
local function places(data, keys)
  local res = {}
  if not data then return res end
  for id, row in pairs(load(data)()) do
    local spawnZones = {}
    if keys.spawns and type(row[keys.spawns]) == 'table' then
      for z in pairs(row[keys.spawns]) do spawnZones[#spawnZones + 1] = z end
    end
    res[tostring(id)] = {
      name = row[keys.name], zone = row[keys.zoneID], zones = spawnZones,
      minLevel = keys.minLevel and row[keys.minLevel],
      maxLevel = keys.maxLevel and row[keys.maxLevel],
      rank = keys.rank and row[keys.rank],
      friendly = keys.friendlyToFaction and row[keys.friendlyToFaction],
    }
  end
  return res
end

local function items(data, keys)
  local res = {}
  if not data then return res end
  for id, row in pairs(load(data)()) do
    res[tostring(id)] = {
      name = row[keys.name],
      npcDrops = keys.npcDrops and row[keys.npcDrops],
      objectDrops = keys.objectDrops and row[keys.objectDrops],
    }
  end
  return res
end

local zones = {}
for _, continent in pairs(l10n.zoneLookup or {}) do
  for id, name in pairs(continent) do zones[tostring(id)] = name end
end
-- Dungeons/raids/battlegrounds live in zoneCategoryLookup; use them for ids still missing.
for _, group in pairs(l10n.zoneCategoryLookup or {}) do
  if type(group) == 'table' then
    for id, name in pairs(group) do
      if type(name) == 'string' and not zones[tostring(id)] then zones[tostring(id)] = name end
    end
  end
end
local dungeonIds = {}
for id in pairs((l10n.zoneCategoryLookup or {})[9] or {}) do dungeonIds[#dungeonIds + 1] = id end
-- Legacy area ids Questie keeps commented out of its lookup.
zones['19'] = zones['19'] or "Zul'Gurub"
local categories = {}
for id, name in pairs(l10n.questCategoryLookup or {}) do categories[tostring(id)] = name end

return enc({
  quests = quests,
  npcs = places(QuestieDB.npcData, QuestieDB.npcKeys),
  objects = places(QuestieDB.objectData, QuestieDB.objectKeys),
  items = items(QuestieDB.itemData, QuestieDB.itemKeys),
  zones = zones,
  categories = categories,
  dungeonIds = dungeonIds,
})
`

const ALLIANCE_LO = 1 | 4 | 8 | 64 | 1024 | 2097152 | 16777216
const HORDE_LO = 2 | 16 | 32 | 128 | 256 | 512 | 33554432
const SKYBORNE_ALLIANCE_HI = 1 // bit 32
const SKYBORNE_HORDE_HI = 2 // bit 33

/** Decodes Questie's requiredRaces bitmask (can exceed 32 bits in Forever). */
export function factionFromRaces(mask: number | undefined): Faction {
  if (!mask) return 'B'
  const lo = mask % 2 ** 32
  const hi = Math.floor(mask / 2 ** 32)
  const a = (lo & ALLIANCE_LO) !== 0 || (hi & SKYBORNE_ALLIANCE_HI) !== 0
  const h = (lo & HORDE_LO) !== 0 || (hi & SKYBORNE_HORDE_HI) !== 0
  if (a && !h) return 'A'
  if (h && !a) return 'H'
  return 'B'
}

const ids = (v: unknown): number[] =>
  Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []

/** First number of each entry, e.g. creature objectives {{id, text}, ...} -> [id, ...]. */
const firstIds = (v: unknown): number[] =>
  Array.isArray(v) ? v.flatMap((e) => (Array.isArray(e) && typeof e[0] === 'number' ? [e[0]] : [])) : []

/** Every number nested anywhere in v (kill-credit objectives are {{npcIds}, baseNpc, text}). */
const allIds = (v: unknown): number[] =>
  Array.isArray(v) ? v.flatMap((e) => (typeof e === 'number' ? [e] : allIds(e))) : []

function placeZones(p: Place | undefined): Set<number> {
  const zones = new Set<number>(p?.zones ?? [])
  if (p?.zone) zones.add(p.zone)
  zones.delete(0)
  return zones
}

/**
 * The dungeon a quest sends you into, found from where its objective mobs/objects
 * spawn and where its objective items drop, plus its quest giver and turn-in NPC.
 * A source only counts when it is found in that one dungeon and nowhere else,
 * so common drops (cloth, ore) that also drop in dungeons don't count.
 * Returns the dungeon's area id, or undefined.
 */
export function questDungeon(x: Extracted, r: RawQuest, dungeonIds: ReadonlySet<number>): number | undefined {
  const [creatures, objects, items, , killCredit] = r.objectives ?? []
  const npcIds = [...firstIds(creatures), ...allIds(killCredit)]
  const objectIds = firstIds(objects)
  const itemIds = [...firstIds(items), ...ids(r.requiredSourceItems)]
  for (const by of [r.startedBy, r.finishedBy]) {
    const [n, o] = by ?? []
    npcIds.push(...ids(n))
    objectIds.push(...ids(o))
  }

  const sources: Set<number>[] = [
    ...npcIds.map((id) => placeZones(x.npcs[id])),
    ...objectIds.map((id) => placeZones(x.objects[id])),
    ...itemIds.map((id) => {
      const item = x.items[id]
      const zones = new Set<number>()
      for (const n of ids(item?.npcDrops)) for (const z of placeZones(x.npcs[n])) zones.add(z)
      for (const o of ids(item?.objectDrops)) for (const z of placeZones(x.objects[o])) zones.add(z)
      return zones
    }),
  ]
  for (const zones of sources) {
    if (zones.size === 1) {
      const [z] = zones
      if (dungeonIds.has(z)) return z
    }
  }
  return undefined
}

export async function extract(raw: RawSources): Promise<Extracted> {
  const lua = await new LuaFactory().createEngine()
  try {
    await lua.doString(PRELUDE_LUA)
    for (const [name, code] of Object.entries(raw)) {
      try {
        await lua.doString(code)
      } catch (err) {
        throw new Error(`Failed to run ${name} Lua file: ${err}`)
      }
    }
    const json = (await lua.doString(EXTRACT_LUA)) as string
    return JSON.parse(json) as Extracted
  } finally {
    lua.global.close()
  }
}

export function normalise(x: Extracted): Quest[] {
  const dungeonIds = new Set(x.dungeonIds ?? [])
  const zoneName = (id: number | undefined): string | undefined => {
    if (id === undefined || id === 0) return undefined
    if (id > 0) return x.zones[id] ?? `Zone #${id}`
    return x.categories[id] ?? `Category #${id}`
  }

  const quests = new Map<number, Quest>()
  for (const r of x.quests) {
    const [creatures, objects, items] = r.startedBy ?? []
    const starters = [
      ...ids(creatures).map((id) => x.npcs[id]?.name ?? `NPC #${id}`),
      ...ids(objects).map((id) => `Object: ${x.objects[id]?.name ?? `#${id}`}`),
      ...ids(items).map((id) => `Item: ${x.items[id]?.name ?? `#${id}`}`),
    ]
    const starterNpcZone = ids(creatures)
      .map((id) => x.npcs[id]?.zone)
      .find((z): z is number => typeof z === 'number' && z > 0)

    const zone = zoneName(r.zoneOrSort) ?? zoneName(starterNpcZone) ?? 'Unknown'
    const dungeon = questDungeon(x, r, dungeonIds)
    quests.set(r.id, {
      id: r.id,
      name: r.name ?? `Quest #${r.id}`,
      level: r.questLevel ?? 0,
      reqLevel: r.requiredLevel ?? 0,
      zone,
      dungeon: dungeon !== undefined && x.zones[dungeon] !== zone ? x.zones[dungeon] : undefined,
      faction: factionFromRaces(r.requiredRaces),
      classes: r.requiredClasses ?? 0,
      starters,
      objective: Array.isArray(r.objectivesText)
        ? r.objectivesText.filter((s) => typeof s === 'string').join(' ') || undefined
        : undefined,
      preAll: ids(r.preQuestGroup),
      preAny: ids(r.preQuestSingle),
      breadcrumbFor: r.breadcrumbForQuestId || undefined,
      exclusiveTo: ids(r.exclusiveTo),
      parent: r.parentQuest || undefined,
      startingWith: r.availableStartingWith || undefined,
      repeatable: ((r.specialFlags ?? 0) & 1) === 1,
    })
  }

  // Some relations are only stored on the other side; mirror them.
  for (const r of x.quests) {
    for (const b of ids(r.breadcrumbs)) {
      const bq = quests.get(b)
      if (bq && !bq.breadcrumbFor) bq.breadcrumbFor = r.id
    }
    for (const c of ids(r.childQuests)) {
      const cq = quests.get(c)
      if (cq && !cq.parent) cq.parent = r.id
    }
  }

  return [...quests.values()].sort((a, b) => a.id - b.id)
}

const ELITE_RANK = 1
const RARE_ELITE_RANK = 2
const BOSS_RANK = 3

/**
 * Dungeons/raids that have at least one quest, with a level range taken from
 * the hostile, non-boss mobs that spawn inside. Sorted by lowest level.
 */
export function dungeonList(x: Extracted, quests: Quest[]): Dungeon[] {
  const used = new Set(quests.flatMap((q) => (q.dungeon ? [q.zone, q.dungeon] : [q.zone])))
  const idsByName = new Map<string, Set<number>>()
  for (const id of x.dungeonIds ?? []) {
    const name = x.zones[id]
    if (!name || !used.has(name)) continue
    if (!idsByName.has(name)) idsByName.set(name, new Set())
    idsByName.get(name)!.add(id)
  }

  const list: Dungeon[] = []
  for (const [name, areaIds] of idsByName) {
    const hostile = Object.values(x.npcs).filter((npc) =>
      !npc.friendly && npc.rank !== BOSS_RANK && npc.minLevel && npc.maxLevel
      && [...placeZones(npc)].some((z) => areaIds.has(z)))
    // Dungeon trash and bosses are elite; non-elites inside are critters, traps, adds.
    const elites = hostile.filter((npc) => npc.rank === ELITE_RANK || npc.rank === RARE_ELITE_RANK)
    const mobs = elites.length ? elites : hostile
    let min = Infinity
    let max = -Infinity
    if (mobs.length) {
      // Skip the lowest 10% so a few odd low-level spawns don't stretch the range.
      const mins = mobs.map((n) => n.minLevel!).sort((a, b) => a - b)
      min = mins[Math.floor(mins.length * 0.1)]
      max = Math.max(...mobs.map((n) => n.maxLevel!))
    }
    if (min === Infinity) {
      // No mob data: fall back to the levels of the dungeon's own quests.
      const levels = quests.filter((q) => q.zone === name && q.level > 0).map((q) => q.level)
      if (levels.length) {
        min = Math.min(...levels)
        max = Math.max(...levels)
      }
    }
    list.push(min === Infinity ? { name } : { name, minLevel: min, maxLevel: max })
  }
  return list.sort((a, b) =>
    (a.minLevel ?? Infinity) - (b.minLevel ?? Infinity)
    || (a.maxLevel ?? Infinity) - (b.maxLevel ?? Infinity)
    || a.name.localeCompare(b.name))
}

export async function convertQuestie(raw: RawSources): Promise<QuestDb> {
  const x = await extract(raw)
  const quests = normalise(x)
  return {
    generatedAt: new Date().toISOString(),
    source: 'Questie QuestieDB (GPL-3.0) — https://github.com/Questie/QuestieDB',
    quests,
    dungeons: dungeonList(x, quests),
  }
}
