import { useMemo, useState } from 'react'
import type { QuestGraph } from '../graph/build'
import { CLASS_NAMES } from '../config'
import type { FactionFilter, ViewOptions } from '../graph/subgraph'
import type { Dungeon } from '../types'

interface Props {
  graph: QuestGraph
  /** Dungeons and raids, sorted by lowest level. */
  dungeons: Dungeon[]
  options: ViewOptions
  onChange: (patch: Partial<ViewOptions>) => void
  onPickQuest: (id: number) => void
  stats: { nodes: number; edges: number }
  generatedAt: string
  tabs: React.ReactNode
}

function dungeonLabel(d: Dungeon, quests: number): string {
  const levels = d.minLevel === undefined ? ''
    : d.minLevel === d.maxLevel ? `[${d.minLevel}] ` : `[${d.minLevel}-${d.maxLevel}] `
  return `${levels}${d.name} · ${quests} ${quests === 1 ? 'quest' : 'quests'}`
}

export function Sidebar({ graph, dungeons, options, onChange, onPickQuest, stats, generatedAt, tabs }: Props) {
  const [search, setSearch] = useState('')
  const [zoneQuery, setZoneQuery] = useState('')
  const [zoneOpen, setZoneOpen] = useState(false)
  const [zoneActive, setZoneActive] = useState(0)

  // Dungeons have their own picker, so they're left out of the zone list.
  const zones = useMemo(() => {
    const dungeonNames = new Set(dungeons.map((d) => d.name))
    const counts = new Map<string, number>()
    for (const q of graph.quests.values()) {
      if (!dungeonNames.has(q.zone)) counts.set(q.zone, (counts.get(q.zone) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [graph, dungeons])

  const dungeonCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const q of graph.quests.values()) {
      for (const d of new Set([q.zone, q.dungeon])) if (d) counts.set(d, (counts.get(d) ?? 0) + 1)
    }
    return dungeons.map((d) => [d, counts.get(d.name) ?? 0] as const)
  }, [graph, dungeons])

  const zoneResults = useMemo(() => {
    const s = zoneQuery.trim().toLowerCase()
    if (!s) return zones
    const starts = zones.filter(([z]) => z.toLowerCase().startsWith(s))
    const contains = zones.filter(([z]) => !z.toLowerCase().startsWith(s) && z.toLowerCase().includes(s))
    return [...starts, ...contains]
  }, [zoneQuery, zones])

  const pickZone = (z: string) => {
    onChange({ zone: z, dungeon: null, focus: null, expanded: new Set() })
    setZoneOpen(false)
    setZoneQuery('')
  }

  const onZoneKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setZoneOpen(true)
      setZoneActive((i) => Math.min(i + 1, zoneResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setZoneActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      const hit = zoneResults[zoneActive]
      if (hit) { pickZone(hit[0]); e.currentTarget.blur() }
    } else if (e.key === 'Escape') {
      setZoneOpen(false)
      setZoneQuery('')
      e.currentTarget.blur()
    }
  }

  const results = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (s.length < 2) return []
    const asId = Number(s)
    return [...graph.quests.values()]
      .filter((q) => q.id === asId || q.name.toLowerCase().includes(s))
      .sort((a, b) => a.level - b.level)
      .slice(0, 40)
  }, [search, graph])

  const factionButton = (value: FactionFilter, label: string) => (
    <button
      className={options.faction === value ? 'active' : ''}
      onClick={() => onChange({ faction: value })}
    >
      {label}
    </button>
  )

  const toggle = (
    key: 'hideUnlinked' | 'onlyNonLinear' | 'collapseChains' | 'showExclusive' | 'hideOtherClasses',
    label: string,
    hint: string,
    disabled = false,
  ) => (
    <label className={`toggle${disabled ? ' disabled' : ''}`} title={hint}>
      <input
        type="checkbox"
        checked={options[key]}
        disabled={disabled}
        onChange={(e) => onChange({ [key]: e.target.checked })}
      />
      {label}
    </label>
  )

  return (
    <aside className="sidebar">
      <header>
        <h1>Forever Quest Chains</h1>
        <p className="muted">
          {graph.quests.size} quests · data from{' '}
          <a href="https://github.com/Questie/QuestieDB" target="_blank" rel="noreferrer">Questie</a>,{' '}
          {new Date(generatedAt).toLocaleDateString()}
        </p>
      </header>
      {tabs}

      <section>
        <label className="field-label" htmlFor="search">Find a quest</label>
        <input
          id="search"
          type="search"
          placeholder="Name or ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {results.length > 0 && (
          <ul className="results">
            {results.map((q) => (
              <li key={q.id}>
                <button onClick={() => { onPickQuest(q.id); setSearch('') }}>
                  <span className={`dot faction-${q.faction}`} />
                  <span className="r-name">{q.name}</span>
                  <span className="muted">{q.level} · {q.zone}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <label className="field-label" htmlFor="zone">Zone / category</label>
<input
          id="zone"
          type="search"
          autoComplete="off"
          role="combobox"
          aria-expanded={zoneOpen}
          aria-controls="zone-list"
          placeholder={
            options.focus !== null ? "— showing one quest's tree —"
              : options.dungeon ? '— showing a dungeon —'
                : options.zone ?? 'Search zones…'
          }
          value={zoneOpen ? zoneQuery : options.focus !== null || options.dungeon ? '' : options.zone ?? ''}
          onFocus={() => { setZoneOpen(true); setZoneQuery(''); setZoneActive(0) }}
          onBlur={() => { setZoneOpen(false); setZoneQuery('') }}
          onChange={(e) => { setZoneQuery(e.target.value); setZoneActive(0) }}
          onKeyDown={onZoneKey}
        />
        {zoneOpen && (
          <ul className="results zone-results" id="zone-list" role="listbox">
            {zoneResults.length === 0 && <li className="muted small empty">No matching zone</li>}
            {zoneResults.map(([z, n], i) => (
              <li key={z} role="option" aria-selected={z === options.zone}>
                <button
                  className={[i === zoneActive ? 'active' : '', z === options.zone ? 'current' : ''].join(' ')}
                  ref={i === zoneActive ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setZoneActive(i)}
                  onClick={() => { pickZone(z); (document.activeElement as HTMLElement | null)?.blur() }}
                >
                  <span className="r-name">{z}</span>
                  <span className="muted">{n}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {options.focus !== null && (
          <button className="link" onClick={() => onChange({ focus: null })}>
            ← back to {options.dungeon ?? options.zone}
          </button>
        )}
      </section>

      {dungeonCounts.length > 0 && (
        <section>
          <label className="field-label" htmlFor="dungeon">Dungeon quest chains</label>
          <select
            id="dungeon"
            value={options.dungeon ?? ''}
            onChange={(e) => onChange({ dungeon: e.target.value || null, focus: null, expanded: new Set() })}
          >
            <option value="">— No dungeon —</option>
            {dungeonCounts.map(([d, n]) => (
              <option key={d.name} value={d.name}>{dungeonLabel(d, n)}</option>
            ))}
          </select>
          {options.dungeon && (
            <p className="muted small">
              Quests in {options.dungeon} (including ones you take or hand in outside it)
              plus every quest that leads to or follows them. Faded boxes are lead-ins and follow-ups.
              {options.focus === null && (
                <>
                  {' '}
                  <button className="link" onClick={() => onChange({ dungeon: null, expanded: new Set() })}>
                    Back to {options.zone ?? 'zones'}
                  </button>
                </>
              )}
            </p>
          )}
        </section>
      )}

      <section>
        <span className="field-label">Faction</span>
        <div className="segmented">
          {factionButton('all', 'All')}
          {factionButton('A', 'Alliance')}
          {factionButton('H', 'Horde')}
        </div>
      </section>

      <section>
        <label className="field-label" htmlFor="class">Your class</label>
        <select
          id="class"
          value={options.playerClass}
          onChange={(e) => onChange({ playerClass: Number(e.target.value) })}
        >
          <option value={0}>— Any class —</option>
          {CLASS_NAMES.map(([bit, name]) => (
            <option key={bit} value={bit}>{name}</option>
          ))}
        </select>
        <div className="toggles class-toggle">
          {toggle(
            'hideOtherClasses',
            'Hide other classes\' quests',
            options.playerClass ? 'Hide quests only other classes can take' : 'Pick your class first',
            !options.playerClass,
          )}
        </div>
      </section>

      <section>
        <span className="field-label">Quest level</span>
        <div className="range">
          <input
            type="number" min={0} max={70} value={options.minLevel}
            onChange={(e) => onChange({ minLevel: Number(e.target.value) || 0 })}
          />
          <span>to</span>
          <input
            type="number" min={0} max={70} value={options.maxLevel}
            onChange={(e) => onChange({ maxLevel: Number(e.target.value) || 0 })}
          />
        </div>
      </section>

      <section className="toggles">
        {toggle('onlyNonLinear', 'Only non-linear unlocks', 'Hide plain A→B→C chains, keep quests that branch or need several quests')}
        {toggle('hideUnlinked', 'Hide standalone quests', 'Hide quests with no prerequisite links')}
        {toggle('collapseChains', 'Collapse long chains', 'Show runs of 3+ linear chain quests as one box')}
        {toggle('showExclusive', 'Show either/or links', 'Quests that lock each other out')}
      </section>

      <section className="legend">
        <span className="field-label">Legend</span>
        <div><i className="line chain" /> chain link (1 → 1)</div>
        <div><i className="line unlock" /> unlock / branch</div>
        <div><i className="line breadcrumb" /> breadcrumb (optional lead-in)</div>
        <div><i className="line conditional" /> available while other quest active</div>
        <div><i className="line exclusive" /> either/or (mutually exclusive)</div>
        <div><i className="swatch class-swatch" /> quest for your class</div>
        <div className="muted small">
          <b>AND</b> = needs all marked quests · <b>OR</b> = any one of them.
          Faded boxes are linked quests from other zones.
          Click a quest for details, double-click to see its whole tree.
        </div>
      </section>

      <footer className="muted small">
        Showing {stats.nodes} boxes · {stats.edges} links
      </footer>
    </aside>
  )
}
