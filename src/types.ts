export type Faction = 'A' | 'H' | 'B'

export interface Quest {
  id: number
  name: string
  level: number
  reqLevel: number
  /** Zone or category name (e.g. "Elwynn Forest", "Warrior", "Cooking"). */
  zone: string
  /**
   * Dungeon this quest sends you into, when it is filed under another zone
   * (e.g. an Orgrimmar quest to kill a boss in Ragefire Chasm).
   */
  dungeon?: string
  faction: Faction
  /** Class bitmask, 0 = any class. */
  classes: number
  /** Who/what starts the quest, e.g. "Marshal McBride" or "Item: Nondescript Letter". */
  starters: string[]
  objective?: string
  /** preQuestGroup: ALL of these must be completed. */
  preAll: number[]
  /** preQuestSingle: ANY ONE of these must be completed. */
  preAny: number[]
  /** This quest is an optional breadcrumb leading to that quest. */
  breadcrumbFor?: number
  /** Completing/taking one of these quests locks this one out. */
  exclusiveTo: number[]
  /** This quest is only available while the parent quest is active. */
  parent?: number
  /** Available once that quest is in the log OR turned in. */
  startingWith?: number
  repeatable: boolean
  /** Base XP reward at the quest's level (Questie's QuestXP data, partly from in-game traces). */
  xp?: number
  /** Items the quest can reward (Questie doesn't say which are a choice). */
  rewardItems?: RewardItem[]
  /** Reputation gained on completion. */
  reputation?: ReputationReward[]
}

export interface RewardItem {
  id: number
  name: string
}

export interface ReputationReward {
  faction: string
  value: number
}

export interface QuestDb {
  generatedAt: string
  source: string
  quests: Quest[]
  /** Dungeons and raids, sorted by lowest level (optional for older data files). */
  dungeons?: Dungeon[]
  /** Typical mob levels per zone, keyed by area id (optional for older data files). */
  zoneLevels?: ZoneLevels[]
}

export interface ZoneLevels {
  /** Area id (AreaTable / Questie zone id). */
  id: number
  name: string
  minLevel: number
  maxLevel: number
}

export interface Dungeon {
  /** Zone name, as used in Quest.zone / Quest.dungeon. */
  name: string
  /** Level range of the hostile mobs inside (bosses excluded). */
  minLevel?: number
  maxLevel?: number
}

export type EdgeKind =
  | 'requires-all'
  | 'requires-any'
  | 'breadcrumb'
  | 'parent-active'
  | 'starting-with'
  | 'exclusive'

export interface QuestEdge {
  id: string
  /** The quest that unlocks (or, for exclusive, one side). */
  source: number
  /** The quest being unlocked. */
  target: number
  kind: EdgeKind
  /** For progression edges: true = plain linear chain link, false = branching unlock. */
  chain: boolean
}

/** Index of the Map tab's worlds (public/data/maps.json, from scripts/import-maps.ts). */
export interface MapIndex {
  generatedAt: string
  source: string
  worlds: { id: number; name: string }[]
}

/**
 * One seamless world map (public/data/maps/<id>.json). Positions are in terrain-chunk
 * cells (~33 yards); a cell is `cellSize` px at `maxZoom`.
 */
export interface WorldMapData {
  /** Map.db2 id (0 Eastern Kingdoms, 1 Kalimdor, ...). */
  id: number
  name: string
  tileSize: number
  maxZoom: number
  cellSize: number
  /** Image tiles that exist, per zoom: "x_y". */
  tiles: Record<number, string[]>
  /** Cells covered by terrain: [x0, y0, x1, y1]. */
  extent: [number, number, number, number]
  zones: ZoneShape[]
}

export interface ZoneShape {
  /** AreaTable id (also Questie's zone id). */
  areaId: number
  uiMapId: number
  name: string
  /** A capital city rather than an outdoor zone. */
  city?: boolean
  /** Label position. */
  x: number
  y: number
  bounds: [number, number, number, number]
  /** Outline rings ([x0, y0, x1, y1, ...]); draw with the even-odd rule. */
  rings: number[][]
  /** Biggest first. */
  subzones: { areaId: number; name: string; x: number; y: number; cells: number }[]
}
