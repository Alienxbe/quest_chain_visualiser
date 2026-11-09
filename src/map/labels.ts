import type { ZoneLevels } from '../types'

/** "3–10", or a single level; undefined when unknown. */
export function levelText(l: ZoneLevels | undefined): string | undefined {
  if (!l) return undefined
  return l.minLevel === l.maxLevel ? `${l.minLevel}` : `${l.minLevel}–${l.maxLevel}`
}
