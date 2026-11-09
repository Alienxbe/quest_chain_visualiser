import { useCallback, useEffect, useMemo, useState } from 'react'
import { buildGraph } from './graph/build'
import { buildView, type ViewOptions } from './graph/subgraph'
import { QuestGraph } from './components/QuestGraph'
import { QuestPanel } from './components/QuestPanel'
import { Sidebar } from './components/Sidebar'
import { DEFAULT_ZONE } from './config'
import type { QuestDb } from './types'

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

  return (
    <div className="app">
      <Sidebar
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
