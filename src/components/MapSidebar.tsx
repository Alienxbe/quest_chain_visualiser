import { useMemo, useState } from 'react'
import { levelText } from '../map/labels'
import type { MapIndex, WorldMapData, ZoneLevels } from '../types'

interface Props {
  index: MapIndex
  worldId: number
  onWorld: (id: number) => void
  /** The selected world, once loaded. */
  world: WorldMapData | null
  levels: Map<number, ZoneLevels>
  onPick: (areaId: number) => void
  tabs: React.ReactNode
}

/** Map tab sidebar: world picker and the world's zones by level, cities last. */
export function MapSidebar({ index, worldId, onWorld, world, levels, onPick, tabs }: Props) {
  const [query, setQuery] = useState('')

  const zones = useMemo(() => {
    const q = query.trim().toLowerCase()
    const key = (z: WorldMapData['zones'][number]) => (z.city ? Infinity : levels.get(z.areaId)?.minLevel ?? 999)
    return (world?.zones ?? [])
      .filter((z) => !q || z.name.toLowerCase().includes(q))
      .sort((a, b) => key(a) - key(b) || a.name.localeCompare(b.name))
  }, [world, levels, query])

  return (
    <aside className="sidebar">
      <header>
        <h1>Forever Quest Chains</h1>
        <p className="muted">Terrain from the WoW Forever client · levels from Questie mob data</p>
      </header>
      {tabs}

      <section>
        <span className="field-label">Continent</span>
        <div className="segmented">
          {index.worlds.map((w) => (
            <button key={w.id} className={w.id === worldId ? 'active' : ''} onClick={() => onWorld(w.id)}>
              {w.name}
            </button>
          ))}
        </div>
      </section>

      <section>
        <label className="field-label" htmlFor="map-zone">Zones</label>
        <input
          id="map-zone"
          type="search"
          placeholder="Filter zones…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul className="results zone-results map-zone-list">
          {zones.map((z) => (
            <li key={z.areaId}>
              <button onClick={() => onPick(z.areaId)}>
                <span className="r-name">{z.name}</span>
                <span className="muted">{z.city ? 'city' : levelText(levels.get(z.areaId)) ?? ''}</span>
              </button>
            </li>
          ))}
          {world && !zones.length && <li className="muted small empty">No matching zone</li>}
        </ul>
      </section>

      <p className="muted small">
        Scroll to zoom and drag to move. Hover a zone to see its outline and level range, and click it to zoom in.
        Zoomed into a zone, the map shows its subzones. Level ranges are the usual levels of each zone's hostile mobs.
      </p>
      <p className="muted small">{index.source}</p>
    </aside>
  )
}
