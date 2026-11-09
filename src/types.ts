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
}

export interface QuestDb {
  generatedAt: string
  source: string
  quests: Quest[]
  /** Dungeons and raids, sorted by lowest level (optional for older data files). */
  dungeons?: Dungeon[]
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
