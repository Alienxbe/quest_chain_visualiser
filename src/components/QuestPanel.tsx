import { useEffect } from 'react'
import type { QuestGraph } from '../graph/build'
import { classList, ITEM_LINK, QUEST_LINK } from '../config'
import type { EdgeKind, Quest } from '../types'

interface Props {
  graph: QuestGraph
  quest: Quest
  onSelect: (id: number) => void
  onFocus: (id: number) => void
  onClose: () => void
}

const KIND_LABEL: Record<EdgeKind, string> = {
  'requires-all': 'required',
  'requires-any': 'one of',
  breadcrumb: 'breadcrumb',
  'parent-active': 'while active',
  'starting-with': 'once accepted',
  exclusive: 'either/or',
}

/** Short note on how this quest contributes to unlocking `target`. */
function unlockNote(kind: EdgeKind, target: Quest | undefined): string | undefined {
  if (kind === 'requires-all') return target && target.preAll.length > 1 ? `+ ${target.preAll.length - 1} more needed` : undefined
  if (kind === 'requires-any') return target && target.preAny.length > 1 ? `or ${target.preAny.length - 1} other` : undefined
  return KIND_LABEL[kind]
}

declare global {
  interface Window {
    /** Set by Wowhead's tooltips.js (loaded in index.html). */
    $WowheadPower?: { refreshLinks: () => void }
  }
}

const FACTION = { A: 'Alliance', H: 'Horde', B: 'Both factions' }

export function QuestPanel({ graph, quest: q, onSelect, onFocus, onClose }: Props) {
  const link = (id: number, note?: string) => {
    const other = graph.quests.get(id)
    return (
      <li key={`${id}-${note}`}>
        <button className="link" onClick={() => onSelect(id)}>
          <span className={`dot faction-${other?.faction ?? 'B'}`} />
          [{other?.level ?? '?'}] {other?.name ?? `#${id}`}
        </button>
        {other && other.zone !== q.zone && <span className="muted small"> · {other.zone}</span>}
        {note && <span className="tag">{note}</span>}
      </li>
    )
  }

  const unlocks = graph.out.get(q.id) ?? []
  const incoming = (graph.in.get(q.id) ?? []).filter(
    (e) => e.kind !== 'requires-all' && e.kind !== 'requires-any',
  )
  const exclusive = (graph.exclusive.get(q.id) ?? []).map((e) => (e.source === q.id ? e.target : e.source))
  const classes = classList(q.classes)

  // Let Wowhead colour and iconize the newly rendered item links.
  useEffect(() => {
    window.$WowheadPower?.refreshLinks()
  }, [q.id])

  return (
    <aside className="panel">
      <button className="close" onClick={onClose} aria-label="Close">×</button>
      <h2>{q.name}</h2>
      <p className="muted">
        #{q.id} · level {q.level} (requires {q.reqLevel}) · {FACTION[q.faction]}
        {classes.length > 0 && <> · {classes.join(', ')}</>}
        {q.repeatable && <> · repeatable</>}
      </p>
      <p><b>{q.zone}</b>{q.dungeon && <> · dungeon: <b>{q.dungeon}</b></>}{q.starters.length > 0 && <> — from {q.starters.join(', ')}</>}</p>
      {q.objective && <p className="objective">{q.objective}</p>}

      {(q.xp || q.rewardItems?.length || q.reputation?.length) ? (
        <>
          <h3>Rewards</h3>
          {/* Keyed by quest: Wowhead edits these links, so remount rather than patch them. */}
          <ul key={q.id}>
            {q.xp ? (
              <li>
                <span className="xp" title="Base XP at the quest's level; less if you are higher level">
                  {q.xp.toLocaleString('en-US')} XP
                </span>
              </li>
            ) : null}
            {q.rewardItems?.map((item) => (
              <li key={`item-${item.id}`}>
                <a href={ITEM_LINK(item.id)} target="_blank" rel="noreferrer" data-wh-icon-size="small">{item.name}</a>
              </li>
            ))}
            {q.reputation?.map((r) => (
              <li key={`rep-${r.faction}`}>
                <span className={r.value < 0 ? 'rep-loss' : 'rep-gain'}>{r.value > 0 ? '+' : ''}{Math.round(r.value)}</span> {r.faction}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <div className="actions">
        <button onClick={() => onFocus(q.id)}>Show whole tree</button>
        <a href={QUEST_LINK(q.id)} target="_blank" rel="noreferrer">Wowhead ↗</a>
      </div>

      {q.preAll.length > 0 && (
        <>
          <h3>Requires {q.preAll.length > 1 ? 'all of' : ''}</h3>
          <ul>{q.preAll.map((id) => link(id))}</ul>
        </>
      )}
      {q.preAny.length > 0 && (
        <>
          <h3>Requires {q.preAny.length > 1 ? 'any one of' : ''}</h3>
          <ul>{q.preAny.map((id) => link(id))}</ul>
        </>
      )}
      {incoming.length > 0 && (
        <>
          <h3>Also linked from</h3>
          <ul>{incoming.map((e) => link(e.source, KIND_LABEL[e.kind]))}</ul>
        </>
      )}
      {unlocks.length > 0 && (
        <>
          <h3>Unlocks {unlocks.length > 1 && <span className="badge unlocks">{unlocks.length} quests</span>}</h3>
          <ul>{unlocks.map((e) => link(e.target, unlockNote(e.kind, graph.quests.get(e.target))))}</ul>
        </>
      )}
      {exclusive.length > 0 && (
        <>
          <h3>Can't do together with</h3>
          <ul>{exclusive.map((id) => link(id))}</ul>
        </>
      )}
      {!q.preAll.length && !q.preAny.length && !unlocks.length && !incoming.length && (
        <p className="muted">No prerequisite links: a standalone quest.</p>
      )}
    </aside>
  )
}
