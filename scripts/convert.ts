import { LuaFactory, type LuaEngine } from 'wasmoon'
import type { Dungeon, Faction, Quest, QuestDb } from '../src/types.ts'
import type { BakedEntities, Row } from './baked.ts'

/** Questie localization lookups (Lua): zone names and quest categories. */
export interface LookupSources {
  zones: string
  categories: string
}

/** Everything the converter needs. */
export interface ConvertInput extends LookupSources {
  /** Quest/NPC/object/item rows from the baked release DB (or entitiesFromLua). */
  entities: BakedEntities
  /** Fallback zone names for ids the l10n lookups don't have (new Forever zones). */
  extraZoneNames?: Record<number, string>
}

export interface ConvertOptions {
  /** Faction id -> name, for reputation rewards. */
  factionNames?: Record<number, string>
  /** Quest id -> base XP reward. */
  questXp?: Record<number, number>
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

/** Entity data in the shape the conversion works on. */
interface Extracted {
  quests: RawQuest[]
  npcs: Record<string, Place>
  objects: Record<string, Place>
  items: Record<string, { name: string; npcDrops?: number[]; objectDrops?: number[]; questRewards?: number[] }>
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
  /** {{factionId, value}, ...}. */
  reputationReward?: unknown[]
}

/**
 * Field positions, from QuestieDB's schemas (src/meta/*Meta.lua, same as the
 * questKeys/npcKeys/... tables in the raw data files).
 */
const QUEST_FIELDS = {
  name: 1, startedBy: 2, finishedBy: 3, requiredLevel: 4, questLevel: 5, requiredRaces: 6,
  requiredClasses: 7, objectivesText: 8, objectives: 10, preQuestGroup: 12, preQuestSingle: 13,
  childQuests: 14, exclusiveTo: 16, zoneOrSort: 17, requiredSourceItems: 21, specialFlags: 24,
  parentQuest: 25, reputationReward: 26, breadcrumbForQuestId: 27, breadcrumbs: 28,
  availableStartingWith: 34,
} as const
const NPC_FIELDS = { name: 1, minLevel: 4, maxLevel: 5, rank: 6, spawns: 7, zoneID: 9, friendlyToFaction: 13 } as const
const OBJECT_FIELDS = { name: 1, spawns: 4, zoneID: 5 } as const
const ITEM_FIELDS = { name: 1, npcDrops: 2, objectDrops: 3, questRewards: 6 } as const

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

/** Lua → JSON encoder. Tables with only positive integer keys become (sparse) arrays. */
const ENCODE_LUA = `
function __enc(v)
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
      for i = 1, maxn do parts[i] = __enc(v[i]) end
      return '[' .. table.concat(parts, ',') .. ']'
    end
    for k, val in pairs(v) do
      parts[#parts + 1] = __enc(tostring(k)) .. ':' .. __enc(val)
    end
    return '{' .. table.concat(parts, ',') .. '}'
  end
  return 'null'
end
`

/** Zone names, quest categories and dungeon ids from Questie's l10n lookups. */
const LOOKUPS_LUA = `
local l10n = __modules.l10n
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
return __enc({ zones = zones, categories = categories, dungeonIds = dungeonIds })
`

/** Raw (unbaked) QuestieDB data files: the rows as written, keyed by id. */
const ENTITIES_LUA = `
local QuestieDB = __modules.QuestieDB
local function rows(data)
  local out = {}
  if data then for id, row in pairs(load(data)()) do out[tostring(id)] = row end end
  return out
end
return __enc({
  quests = rows(QuestieDB.questData),
  npcs = rows(QuestieDB.npcData),
  objects = rows(QuestieDB.objectData),
  items = rows(QuestieDB.itemData),
})
`

async function runLua<T>(sources: Record<string, string>, script: string): Promise<T> {
  const lua: LuaEngine = await new LuaFactory().createEngine()
  try {
    await lua.doString(PRELUDE_LUA)
    await lua.doString(ENCODE_LUA)
    for (const [name, code] of Object.entries(sources)) {
      try {
        await lua.doString(code)
      } catch (err) {
        throw new Error(`Failed to run ${name} Lua file: ${err}`)
      }
    }
    return JSON.parse((await lua.doString(script)) as string) as T
  } finally {
    lua.global.close()
  }
}

/**
 * Loads raw QuestieDB Lua data files (questData, npcData, ...) into rows. The release
 * build is the real source; this reads the old-style files, which the tests use.
 */
export async function entitiesFromLua(raw: { quests: string; npcs: string; objects: string; items: string }): Promise<BakedEntities> {
  const parsed = await runLua<Record<keyof BakedEntities, Record<string, unknown>>>(raw, ENTITIES_LUA)
  // An empty Lua table encodes as [] rather than {}.
  const asRows = (v: unknown) => (Array.isArray(v) ? {} : v) as Record<string, Row>
  return {
    quests: asRows(parsed.quests),
    npcs: asRows(parsed.npcs),
    objects: asRows(parsed.objects),
    items: asRows(parsed.items),
  }
}

/** Field `index` (1-based) of a row, or undefined when absent. */
function field<T = unknown>(row: Row, index: number): T | undefined {
  const v = row[index - 1]
  return v === null || v === undefined ? undefined : (v as T)
}

/** Zone ids of a spawn list: a map keyed by zone id, or a sparse array from the Lua export. */
function spawnZones(v: unknown): number[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => (x === null || x === undefined ? [] : [i + 1]))
  if (v && typeof v === 'object') return Object.keys(v).map(Number).filter(Number.isFinite)
  return []
}

function place(row: Row, f: { name: number; spawns: number; zoneID: number }): Place {
  return { name: field<string>(row, f.name)!, zone: field<number>(row, f.zoneID), zones: spawnZones(field(row, f.spawns)) }
}

/** Maps entity rows and the l10n lookups into the shape the conversion works on. */
export async function extract(input: ConvertInput): Promise<Extracted> {
  const lookups = await runLua<Pick<Extracted, 'zones' | 'categories' | 'dungeonIds'>>(
    { zones: input.zones, categories: input.categories }, LOOKUPS_LUA)
  // Lua encodes an empty table as [], so normalise those.
  const obj = <T>(v: unknown) => (Array.isArray(v) && !v.length ? {} : v) as Record<string, T>
  const { entities } = input

  const quests: RawQuest[] = Object.entries(entities.quests).map(([id, row]) => {
    const q: RawQuest & Record<string, unknown> = { id: Number(id) }
    for (const [name, index] of Object.entries(QUEST_FIELDS)) {
      const v = field(row, index)
      if (v !== undefined) q[name] = v
    }
    return q
  })

  const npcs: Record<string, Place> = {}
  for (const [id, row] of Object.entries(entities.npcs)) {
    npcs[id] = {
      ...place(row, NPC_FIELDS),
      minLevel: field<number>(row, NPC_FIELDS.minLevel),
      maxLevel: field<number>(row, NPC_FIELDS.maxLevel),
      rank: field<number>(row, NPC_FIELDS.rank),
      friendly: field<string>(row, NPC_FIELDS.friendlyToFaction),
    }
  }
  const objects: Record<string, Place> = {}
  for (const [id, row] of Object.entries(entities.objects)) objects[id] = place(row, OBJECT_FIELDS)

  const items: Extracted['items'] = {}
  for (const [id, row] of Object.entries(entities.items)) {
    items[id] = {
      name: field<string>(row, ITEM_FIELDS.name)!,
      npcDrops: field(row, ITEM_FIELDS.npcDrops),
      objectDrops: field(row, ITEM_FIELDS.objectDrops),
      questRewards: field(row, ITEM_FIELDS.questRewards),
    }
  }

  const zones = obj<string>(lookups.zones)
  for (const [id, name] of Object.entries(input.extraZoneNames ?? {})) zones[id] ??= name

  return {
    quests,
    npcs,
    objects,
    items,
    zones,
    categories: obj<string>(lookups.categories),
    dungeonIds: lookups.dungeonIds ?? [],
  }
}

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

/**
 * Parses Questie's faction DBC export (faction_classic.csv) into id -> name.
 * Only the ID and Name_lang columns are used.
 */
export function parseFactionCsv(csv: string): Record<number, string> {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i]
    if (quoted) {
      if (c === '"' && csv[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && csv[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }

  const [header, ...data] = rows
  const idCol = header?.indexOf('ID') ?? -1
  const nameCol = header?.indexOf('Name_lang') ?? -1
  const names: Record<number, string> = {}
  if (idCol < 0 || nameCol < 0) return names
  for (const r of data) {
    const id = Number(r[idCol])
    if (Number.isInteger(id) && r[nameCol]) names[id] = r[nameCol]
  }
  return names
}

export function normalise(x: Extracted, { factionNames = {}, questXp = {} }: ConvertOptions = {}): Quest[] {
  const rewardItems = new Map<number, { id: number; name: string }[]>()
  for (const [itemId, item] of Object.entries(x.items)) {
    for (const questId of ids(item.questRewards)) {
      if (!rewardItems.has(questId)) rewardItems.set(questId, [])
      rewardItems.get(questId)!.push({ id: Number(itemId), name: item.name ?? `Item #${itemId}` })
    }
  }
  for (const list of rewardItems.values()) list.sort((a, b) => a.id - b.id)

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
      xp: questXp[r.id] || undefined,
      rewardItems: rewardItems.get(r.id),
      reputation: reputationRewards(r.reputationReward, factionNames),
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

function reputationRewards(v: unknown, names: Record<number, string>) {
  if (!Array.isArray(v)) return undefined
  const list = v.flatMap((e) =>
    Array.isArray(e) && typeof e[0] === 'number' && typeof e[1] === 'number' && e[1] !== 0
      ? [{ faction: names[e[0]] ?? `Faction #${e[0]}`, value: e[1] }]
      : [])
  return list.length ? list : undefined
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

export async function convertQuestie(
  input: ConvertInput,
  options: ConvertOptions & { source?: string } = {},
): Promise<QuestDb> {
  const x = await extract(input)
  const quests = normalise(x, options)
  return {
    generatedAt: new Date().toISOString(),
    source: options.source ?? 'Questie QuestieDB (GPL-3.0) — https://github.com/Questie/QuestieDB',
    quests,
    dungeons: dungeonList(x, quests),
  }
}
