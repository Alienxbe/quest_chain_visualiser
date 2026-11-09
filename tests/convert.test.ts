import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeCbor, parseBakedToc, parseEnumNames, parseQuestXp } from '../scripts/baked'
import { convertQuestie, entitiesFromLua, factionFromRaces, parseFactionCsv } from '../scripts/convert'

const quests = readFileSync(join(__dirname, 'fixtures', 'quests.lua'), 'utf8')

const npcs = `
local QuestieDB = QuestieLoader:ImportModule("QuestieDB");
QuestieDB.npcKeys = { ['name'] = 1, ['zoneID'] = 9 }
QuestieDB.npcData = [[return {
[197] = {'Marshal McBride',nil,nil,nil,nil,nil,nil,nil,12},
[823] = {'Deputy Willem',nil,nil,nil,nil,nil,nil,nil,12},
}]]`
const empty = (kind: string) => `
local QuestieDB = QuestieLoader:ImportModule("QuestieDB");
QuestieDB.${kind}Keys = { ['name'] = 1 }
QuestieDB.${kind}Data = [[return {}]]`
const zones = `
local l10n = QuestieLoader:ImportModule("l10n")
l10n.zoneLookup = { [0] = { [9] = "Northshire Valley", [12] = "Elwynn Forest", [40] = "Westfall" } }`
const categories = `
local l10n = QuestieLoader:ImportModule("l10n")
l10n.questCategoryLookup = { [-81] = "Warrior" }`

describe('convertQuestie', async () => {
  const entities = await entitiesFromLua({ quests, npcs, objects: empty('object'), items: empty('item') })
  const db = await convertQuestie({ entities, zones, categories })
  const byId = new Map(db.quests.map((q) => [q.id, q]))

  it('reads every quest in the fixture', () => {
    expect([...byId.keys()]).toEqual([7, 12, 13, 14, 15, 18, 21, 783, 9001, 9002, 9003])
  })

  it('maps names, levels, zones and starters', () => {
    expect(byId.get(7)).toMatchObject({
      name: 'Kobold Camp Cleanup',
      level: 2,
      reqLevel: 1,
      zone: 'Northshire Valley',
      faction: 'A',
      starters: ['Marshal McBride'],
      preAny: [783],
      preAll: [],
    })
    expect(byId.get(9001)!.zone).toBe('Warrior')
  })

  it('reads all-of prerequisites, exclusive links and mirrored breadcrumbs', () => {
    expect(byId.get(9001)).toMatchObject({ preAll: [12, 7], exclusiveTo: [9002], faction: 'H' })
    expect(byId.get(9003)!.breadcrumbFor).toBe(9002)
  })
})

describe('rewards', async () => {
  const items = `
local QuestieDB = QuestieLoader:ImportModule("QuestieDB");
QuestieDB.itemKeys = { ['name'] = 1, ['questRewards'] = 6 }
QuestieDB.itemData = [[return {
[2047] = {'Anvilmar Hand Axe',nil,nil,nil,nil,{7, 12}},
[25] = {'Worn Shortsword',nil,nil,nil,nil,{7}},
}]]`
  const entities = await entitiesFromLua({ quests, npcs, objects: empty('object'), items })
  const db = await convertQuestie(
    { entities, zones, categories },
    { factionNames: { 72: 'Stormwind' }, questXp: { 7: 170 } },
  )
  const byId = new Map(db.quests.map((q) => [q.id, q]))

  it('maps reward items back to their quests', () => {
    expect(byId.get(7)!.rewardItems).toEqual([
      { id: 25, name: 'Worn Shortsword' },
      { id: 2047, name: 'Anvilmar Hand Axe' },
    ])
    expect(byId.get(12)!.rewardItems).toEqual([{ id: 2047, name: 'Anvilmar Hand Axe' }])
    expect(byId.get(13)!.rewardItems).toBeUndefined()
  })

  it('names reputation rewards', () => {
    expect(byId.get(7)!.reputation).toEqual([{ faction: 'Stormwind', value: 250 }])
  })

  it('adds XP from the QuestXP table', () => {
    expect(byId.get(7)!.xp).toBe(170)
    expect(byId.get(12)!.xp).toBeUndefined()
  })
})

/** Minimal CBOR encoder for test data (ints, strings, arrays, maps). */
function cbor(v: unknown): Buffer {
  const head = (mt: number, n: number) => {
    if (n < 24) return Buffer.from([(mt << 5) | n])
    if (n < 256) return Buffer.from([(mt << 5) | 24, n])
    const b = Buffer.alloc(5); b[0] = (mt << 5) | 26; b.writeUInt32BE(n, 1); return b
  }
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v)
  if (typeof v === 'string') { const s = Buffer.from(v); return Buffer.concat([head(2, s.length), s]) }
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cbor)])
  const entries = Object.entries(v as object)
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, x]) =>
    [cbor(/^\d+$/.test(k) ? Number(k) : k), cbor(x)])])
}
const b64 = (v: unknown) => cbor(v).toString('base64')

describe('baked release DB', () => {
  it('decodes CBOR, including half-precision floats', () => {
    expect(decodeCbor(cbor({ 1: 'Name', p: 6 }))).toEqual({ 1: 'Name', p: 6 })
    expect(decodeCbor(Uint8Array.from([0xf9, 0x3e, 0x00]))).toBe(1.5)
  })

  it('parses rows from the .toc, reassembling chunks and keeping spawn maps', () => {
    const questGivers = b64({ 1: [197] })
    const toc = [
      '## Title: QuestieDB',
      `## X-Quest-7-S: ${b64({ 1: 'Kobold Camp Cleanup', 4: 1, 5: 2, p: 2 })}`,
      '## X-Quest-7-2: ~2~',
      `## X-Quest-7-2-1: ${questGivers.slice(0, 2)}`,
      `## X-Quest-7-2-2: ${questGivers.slice(2)}`,
      `## X-Quest-7-13: ${b64([783])}`,
      `## X-Npc-197-S: ${b64({ 1: 'Marshal McBride', 9: 12 })}`,
      `## X-Npc-197-7: ${b64({ 12: [[1, 2]], 9: [[3, 4]] })}`,
      `## X-Quest-IDS: ${b64([7])}`,
    ].join('\r\n')
    const e = parseBakedToc(toc)
    expect(e.quests['7']).toEqual(['Kobold Camp Cleanup', [[197]], null, 1, 2, null, null, null, null, null, null, null, [783]])
    expect(e.npcs['197'][0]).toBe('Marshal McBride')
    expect(e.npcs['197'][6]).toEqual({ 9: [[3, 4]], 12: [[1, 2]] })
  })

  it('reads QuestXP files, later files overriding earlier ones', () => {
    const classic = 'QuestXP.db = {\n  [2] = {30, 2450}, -- Classic\n  [7] = {2, 170},\n}'
    const traces = 'QuestXP.db[7] = {2, 175}\nQuestXP.db[99] = {10, 630}'
    expect(parseQuestXp(classic, traces)).toEqual({ 2: 2450, 7: 175, 99: 630 })
  })
})

describe('parseEnumNames', () => {
  it('turns enum symbols into readable names, keeping the first alias', () => {
    const lua = 'constants.factionIDs = {\n  KIRIN_TOR_FOREVER = 2740,\n  GUARDIANS_OF_HYJAL = 2765,\n  ALIAS = 2740,\n}'
    expect(parseEnumNames(lua)).toEqual({ 2740: 'Kirin Tor', 2765: 'Guardians of Hyjal' })
  })
})

describe('parseFactionCsv', () => {
  it('reads ID and Name_lang, including quoted names with commas', () => {
    const csv = 'A,Name_lang,Desc,ID\r\n0,"PLAYER, Human",,1\r\n0,Stormwind,"says ""hi""",72\r\n'
    expect(parseFactionCsv(csv)).toEqual({ 1: 'PLAYER, Human', 72: 'Stormwind' })
  })
})

describe('factionFromRaces', () => {
  it('decodes classic and Skyborne race bits', () => {
    expect(factionFromRaces(0)).toBe('B')
    expect(factionFromRaces(77)).toBe('A')
    expect(factionFromRaces(178)).toBe('H')
    expect(factionFromRaces(4294967373)).toBe('A')
    expect(factionFromRaces(8589934770)).toBe('H')
    expect(factionFromRaces(255)).toBe('B')
  })
})
