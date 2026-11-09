import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { convertQuestie, factionFromRaces } from '../scripts/convert'

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
  const db = await convertQuestie({
    quests, npcs, objects: empty('object'), items: empty('item'), zones, categories,
  })
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
