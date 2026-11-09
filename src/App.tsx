import { useCallback, useEffect, useMemo, useState } from 'react'
import { buildGraph } from './graph/build'
import { buildView, type ViewOptions } from './graph/subgraph'
import { QuestGraph } from './components/QuestGraph'
import { QuestPanel } from './components/QuestPanel'
import { Sidebar } from './components/Sidebar'
import { MapSidebar } from './components/MapSidebar'
import { WorldMap } from './components/WorldMap'
import { DEFAULT_ZONE } from './config'
import type { MapIndex, QuestDb, WorldMapData } from './types'

type Tab = 'chains' | 'map'

const loadJson = <T,>(path: string) =>
  fetch(`${import.meta.env.BASE_URL}data/${path}`).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status} — did you run "npm run import-maps"?`)
    return r.json() as Promise<T>
  })

const tabFromHash = (): Tab => (window.location.hash === '#map' ? 'map' : 'chains')

const CLASS_KEY = 'playerClass'

function loadClass(): number {
  try {
    return Number(localStorage.getItem(CLASS_KEY)) || 0
  } catch {
    return 0
  }
}

const INITIAL: ViewOptions = {
  zone: DEFAULT_ZONE,
  dungeon: null,
  focus: null,
  faction: 'all',
  minLevel: 0,
  maxLevel: 70,
  hideUnlinked: true,
  onlyNonLinear: false,
  collapseChains: false,
  showExclusive: true,
  playerClass: loadClass(),
  hideOtherClasses: false,
  expanded: new Set(),
}

export default function App() {
  const [db, setDb] = useState<QuestDb | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [options, setOptions] = useState<ViewOptions>(INITIAL)
  const [selected, setSelected] = useState<number | null>(null)
  const [tab, setTab] = useState<Tab>(tabFromHash)
  const [maps, setMaps] = useState<MapIndex | null>(null)
  const [mapError, setMapError] = useState<string | null>(null)
  const [worldId, setWorldId] = useState<number | null>(null)
  const [worlds, setWorlds] = useState<Map<number, WorldMapData>>(new Map())
  const [mapTarget, setMapTarget] = useState<{ areaId: number } | null>(null)

  useEffect(() => {
    const onHash = () => setTab(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // The map data is only loaded once the Map tab is opened, one world at a time.
  useEffect(() => {
    if (tab !== 'map' || maps || mapError) return
    loadJson<MapIndex>('maps.json')
      .then((m) => {
        setMaps(m)
        setWorldId(m.worlds[0]?.id ?? null)
      })
      .catch((e) => setMapError(String(e)))
  }, [tab, maps, mapError])

  useEffect(() => {
    if (worldId === null || worlds.has(worldId)) return
    loadJson<WorldMapData>(`maps/${worldId}.json`)
      .then((w) => setWorlds((all) => new Map(all).set(w.id, w)))
      .catch((e) => setMapError(String(e)))
  }, [worldId, worlds])

  const zoneLevels = useMemo(() => new Map((db?.zoneLevels ?? []).map((z) => [z.id, z])), [db])

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/quests.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} — did you run "npm run import-data"?`)
        return r.json() as Promise<QuestDb>
      })
      .then(setDb)
      .catch((e) => setError(String(e)))
  }, [])

  const graph = useMemo(() => (db ? buildGraph(db.quests) : null), [db])
  const view = useMemo(() => (graph ? buildView(graph, options) : null), [graph, options])

  useEffect(() => {
    try {
      localStorage.setItem(CLASS_KEY, String(options.playerClass))
    } catch {
      // storage unavailable (private mode etc.): the choice just isn't remembered
    }
  }, [options.playerClass])

  const patch = useCallback((p: Partial<ViewOptions>) => setOptions((o) => ({ ...o, ...p })), [])
  const focus = useCallback((id: number) => {
    setSelected(id)
    setOptions((o) => ({ ...o, focus: id, expanded: new Set() }))
  }, [])
  const expand = useCallback(
    (gid: string) => setOptions((o) => ({ ...o, expanded: new Set([...o.expanded, gid]) })),
    [],
  )

  if (error) return <div className="empty">Could not load quest data: {error}</div>
  if (!db || !graph || !view) return <div className="empty">Loading quests…</div>

  const selectedQuest = selected !== null ? graph.quests.get(selected) : undefined

  const tabs = (
    <nav className="tabs segmented" aria-label="View">
      <a href="#" className={tab === 'chains' ? 'active' : ''} aria-current={tab === 'chains' ? 'page' : undefined}>Quest chains</a>
      <a href="#map" className={tab === 'map' ? 'active' : ''} aria-current={tab === 'map' ? 'page' : undefined}>Map</a>
    </nav>
  )

  if (tab === 'map') {
    return (
      <div className="app">
        {maps && worldId !== null ? (
          <>
            <MapSidebar
              index={maps}
              worldId={worldId}
              onWorld={setWorldId}
              world={worlds.get(worldId) ?? null}
              levels={zoneLevels}
              onPick={(areaId) => setMapTarget({ areaId })}
              tabs={tabs}
            />
            <main className="canvas">
              {worlds.has(worldId)
                ? <WorldMap key={worldId} world={worlds.get(worldId)!} levels={zoneLevels} target={mapTarget} />
                : <div className="empty">{mapError ? `Could not load map data: ${mapError}` : 'Loading map…'}</div>}
            </main>
          </>
        ) : (
          <>
            <aside className="sidebar">{tabs}</aside>
            <div className="empty">{mapError ? `Could not load map data: ${mapError}` : 'Loading map…'}</div>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="app">
      <Sidebar
        tabs={tabs}
        graph={graph}
        dungeons={db.dungeons ?? []}
        options={options}
        onChange={patch}
        onPickQuest={focus}
        stats={{ nodes: view.nodes.length, edges: view.edges.length }}
        generatedAt={db.generatedAt}
      />
      <main className="canvas">
        <QuestGraph
          graph={graph}
          view={view}
          playerClass={options.playerClass}
          selected={selected}
          onSelect={setSelected}
          onFocus={focus}
          onExpand={expand}
        />
      </main>
      {selectedQuest && (
        <QuestPanel
          graph={graph}
          quest={selectedQuest}
          onSelect={setSelected}
          onFocus={focus}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
