import type { EdgeKind, Quest, QuestEdge } from '../types'
import type { QuestGraph } from './build'

export type FactionFilter = 'all' | 'A' | 'H'

export interface ViewOptions {
  /** Show one zone's quests (plus linked quests from elsewhere, marked external). */
  zone: string | null
  /**
   * If set (and no focus), show this dungeon's quests plus their full chains:
   * every quest leading to or following them, wherever it is.
   */
  dungeon: string | null
  /** If set, show this quest's full ancestor + descendant tree instead of a zone. */
  focus: number | null
  faction: FactionFilter
  minLevel: number
  maxLevel: number
  hideUnlinked: boolean
  onlyNonLinear: boolean
  collapseChains: boolean
  showExclusive: boolean
  /** Class bit of the player's class (see CLASS_NAMES), 0 = none chosen. */
  playerClass: number
  /** Hide quests restricted to other classes (needs playerClass). */
  hideOtherClasses: boolean
  /** Ids of collapsed chain groups the user expanded. */
  expanded: ReadonlySet<string>
}

export interface ViewNode {
  id: string
  /** For a quest node: the quest. For a chain group: its first quest. */
  quest: Quest
  /** Set when this node is a collapsed linear chain. */
  members?: Quest[]
  external: boolean
  focused: boolean
  /** Class-restricted quest available to the player's class. */
  forClass: boolean
}

export interface ViewEdge {
  id: string
  source: string
  target: string
  kind: EdgeKind
  chain: boolean
}

export interface View {
  nodes: ViewNode[]
  edges: ViewEdge[]
}

const MIN_CHAIN_GROUP = 3

function factionOk(q: Quest, f: FactionFilter) {
  return f === 'all' || q.faction === 'B' || q.faction === f
}

/** True when the quest is class-restricted and the player's class is one of them. */
export function isClassQuest(q: Quest, playerClass: number): boolean {
  return playerClass !== 0 && q.classes !== 0 && (q.classes & playerClass) !== 0
}

/** Filed under the dungeon, or sends you into it from elsewhere. */
export function inDungeon(q: Quest, dungeon: string): boolean {
  return q.zone === dungeon || q.dungeon === dungeon
}

function classOk(q: Quest, o: ViewOptions) {
  return !o.hideOtherClasses || o.playerClass === 0 || q.classes === 0 || (q.classes & o.playerClass) !== 0
}

/** All quests reachable backwards and forwards from `id` via progression/breadcrumb edges. */
export function questTree(g: QuestGraph, id: number): Set<number> {
  const result = new Set<number>([id])
  const walk = (start: number, next: (n: number) => number[]) => {
    const stack = [start]
    while (stack.length) {
      for (const n of next(stack.pop()!)) {
        if (!result.has(n)) {
          result.add(n)
          stack.push(n)
        }
      }
    }
  }
  walk(id, (n) => (g.in.get(n) ?? []).map((e) => e.source))
  walk(id, (n) => (g.out.get(n) ?? []).map((e) => e.target))
  return result
}

function edgesBetween(g: QuestGraph, visible: Set<number>, o: ViewOptions): QuestEdge[] {
  return g.edges.filter(
    (e) => visible.has(e.source) && visible.has(e.target) && (o.showExclusive || e.kind !== 'exclusive'),
  )
}

export function buildView(g: QuestGraph, o: ViewOptions): View {
  const core = new Set<number>()
  const external = new Set<number>()

  if (o.focus !== null && g.quests.has(o.focus)) {
    for (const id of questTree(g, o.focus)) {
      if (id === o.focus || classOk(g.quests.get(id)!, o)) core.add(id)
    }
  } else if (o.dungeon) {
    for (const q of g.quests.values()) {
      if (inDungeon(q, o.dungeon) && factionOk(q, o.faction) && classOk(q, o) && q.level >= o.minLevel && q.level <= o.maxLevel) {
        core.add(q.id)
      }
    }
    // The level filter applies to the dungeon quests only: lead-ins are usually lower level.
    for (const id of [...core]) {
      for (const n of questTree(g, id)) {
        const lq = g.quests.get(n)!
        if (core.has(n) || !factionOk(lq, o.faction) || !classOk(lq, o)) continue
        if (inDungeon(lq, o.dungeon)) core.add(n)
        else external.add(n)
      }
    }
    if (o.showExclusive) {
      for (const id of [...core, ...external]) {
        for (const e of g.exclusive.get(id) ?? []) {
          const n = e.source === id ? e.target : e.source
          const lq = g.quests.get(n)!
          if (!core.has(n) && factionOk(lq, o.faction) && classOk(lq, o)) external.add(n)
        }
      }
    }
  } else if (o.zone) {
    for (const q of g.quests.values()) {
      if (q.zone === o.zone && factionOk(q, o.faction) && classOk(q, o) && q.level >= o.minLevel && q.level <= o.maxLevel) {
        core.add(q.id)
      }
    }
    // One hop of linked quests from other zones / outside the filters, for context.
    for (const id of core) {
      const linked = [
        ...(g.in.get(id) ?? []).map((e) => e.source),
        ...(g.out.get(id) ?? []).map((e) => e.target),
        ...(o.showExclusive ? (g.exclusive.get(id) ?? []).map((e) => (e.source === id ? e.target : e.source)) : []),
      ]
      for (const n of linked) {
        const lq = g.quests.get(n)!
        if (!core.has(n) && factionOk(lq, o.faction) && classOk(lq, o)) external.add(n)
      }
    }
  }

  // In dungeon view, the dungeon's own quests stay visible even without links.
  const dungeonMode = o.focus === null && !!o.dungeon
  let visible = new Set([...core, ...external])
  let edges = edgesBetween(g, visible, o)

  if (o.onlyNonLinear) {
    const keep = new Set<number>()
    for (const e of edges) {
      if (!e.chain) {
        keep.add(e.source)
        keep.add(e.target)
      }
    }
    if (o.focus !== null) keep.add(o.focus)
    if (dungeonMode) for (const id of core) keep.add(id)
    visible = keep
    edges = edgesBetween(g, visible, o)
  }

  if (o.hideUnlinked) {
    const linked = new Set<number>()
    for (const e of edges) {
      linked.add(e.source)
      linked.add(e.target)
    }
    if (o.focus !== null) linked.add(o.focus)
    if (dungeonMode) for (const id of core) linked.add(id)
    visible = new Set([...visible].filter((id) => linked.has(id)))
  }

  // Collapse runs of plain chain links (A→B→C… each 1-in/1-out) into one node.
  const groupOf = new Map<number, string>()
  const groups = new Map<string, Quest[]>()
  if (o.collapseChains) {
    const next = new Map<number, number>()
    const hasPrev = new Set<number>()
    for (const e of edges) {
      if (e.chain) {
        next.set(e.source, e.target)
        hasPrev.add(e.target)
      }
    }
    for (const start of next.keys()) {
      if (hasPrev.has(start)) continue
      const run = [start]
      let cur = start
      while (next.has(cur)) {
        cur = next.get(cur)!
        run.push(cur)
      }
      const gid = `chain:${start}`
      if (run.length < MIN_CHAIN_GROUP || o.expanded.has(gid) || run.includes(o.focus ?? -1)) continue
      groups.set(gid, run.map((id) => g.quests.get(id)!))
      for (const id of run) groupOf.set(id, gid)
    }
  }

  const nodeId = (id: number) => groupOf.get(id) ?? String(id)
  const nodes: ViewNode[] = []
  for (const id of visible) {
    if (groupOf.has(id)) continue
    nodes.push({
      id: String(id),
      quest: g.quests.get(id)!,
      external: external.has(id),
      focused: id === o.focus,
      forClass: isClassQuest(g.quests.get(id)!, o.playerClass),
    })
  }
  for (const [gid, members] of groups) {
    nodes.push({
      id: gid,
      quest: members[0],
      members,
      external: members.every((m) => external.has(m.id)),
      focused: false,
      forClass: members.some((m) => isClassQuest(m, o.playerClass)),
    })
  }

  const viewEdges = new Map<string, ViewEdge>()
  for (const e of edges) {
    if (!visible.has(e.source) || !visible.has(e.target)) continue
    const source = nodeId(e.source)
    const target = nodeId(e.target)
    if (source === target) continue
    const id = `${e.kind}:${source}-${target}`
    if (!viewEdges.has(id)) viewEdges.set(id, { id, source, target, kind: e.kind, chain: e.chain })
  }

  nodes.sort((a, b) => a.quest.level - b.quest.level || a.quest.id - b.quest.id)
  return { nodes, edges: [...viewEdges.values()] }
}
