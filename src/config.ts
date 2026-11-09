/**
 * Link used for "Open on Wowhead". Wowhead's WoW Forever section URL is not
 * confirmed yet; Classic Era pages cover the original quests. Change this if
 * Wowhead (or another site) adds a Forever database.
 */
export const QUEST_LINK = (id: number) => `https://www.wowhead.com/classic/quest=${id}`

export const DEFAULT_ZONE = 'Northshire Valley'

export const CLASS_NAMES: [number, string][] = [
  [1, 'Warrior'],
  [2, 'Paladin'],
  [4, 'Hunter'],
  [8, 'Rogue'],
  [16, 'Priest'],
  [64, 'Shaman'],
  [128, 'Mage'],
  [256, 'Warlock'],
  [1024, 'Druid'],
]

/** Standard WoW class colours, used to highlight the player's class quests. */
export const CLASS_COLOURS: Record<number, string> = {
  1: '#c69b6d',
  2: '#f48cba',
  4: '#aad372',
  8: '#fff468',
  16: '#ffffff',
  64: '#0070dd',
  128: '#3fc7eb',
  256: '#8788ee',
  1024: '#ff7c0a',
}

export function classList(mask: number): string[] {
  return CLASS_NAMES.filter(([bit]) => (mask & bit) !== 0).map(([, n]) => n)
}
