import type { EdgeKind, Quest, QuestEdge } from '../types'

/** Edge kinds that mean "completing/taking A makes B available". */
export const PROGRESSION_KINDS: ReadonlySet<EdgeKind> = new Set([
  'requires-all',
  'requires-any',
  'starting-with',
  'parent-active',
])

export interface QuestGraph {
  quests: Map<number, Quest>
  edges: QuestEdge[]
  /** Outgoing progression + breadcrumb edges per quest. */
  out: Map<number, QuestEdge[]>
  /** Incoming progression + breadcrumb edges per quest. */
  in: Map<number, QuestEdge[]>
  /** Exclusive links per quest (both directions). */
  exclusive: Map<number, QuestEdge[]>
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

/**
 * Builds typed edges from the quest prerequisite fields, then classifies each
 * progression edge A→B as a plain chain link (A unlocks only B and B needs only A)
 * or a branching unlock (anything else).
 */
export function buildGraph(questList: Quest[]): QuestGraph {
  const quests = new Map(questList.map((q) => [q.id, q]))
  const edges: QuestEdge[] = []
  const seen = new Set<string>()

  const add = (source: number, target: number, kind: EdgeKind) => {
    if (source === target || !quests.has(source) || !quests.has(target)) return
    const id = kind === 'exclusive'
      ? `x:${Math.min(source, target)}-${Math.max(source, target)}`
      : `${kind}:${source}-${target}`
    if (seen.has(id)) return
    seen.add(id)
    edges.push({ id, source, target, kind, chain: false })
  }

  for (const q of questList) {
    for (const p of q.preAll) add(p, q.id, 'requires-all')
    for (const p of q.preAny) add(p, q.id, 'requires-any')
    if (q.startingWith) add(q.startingWith, q.id, 'starting-with')
    if (q.parent) add(q.parent, q.id, 'parent-active')
    if (q.breadcrumbFor) add(q.id, q.breadcrumbFor, 'breadcrumb')
    for (const x of q.exclusiveTo) add(q.id, x, 'exclusive')
  }

  const outCount = new Map<number, number>()
  const inCount = new Map<number, number>()
  for (const e of edges) {
    if (!PROGRESSION_KINDS.has(e.kind)) continue
    outCount.set(e.source, (outCount.get(e.source) ?? 0) + 1)
    inCount.set(e.target, (inCount.get(e.target) ?? 0) + 1)
  }
  for (const e of edges) {
    e.chain = PROGRESSION_KINDS.has(e.kind)
      && outCount.get(e.source) === 1
      && inCount.get(e.target) === 1
  }

  const out = new Map<number, QuestEdge[]>()
  const inn = new Map<number, QuestEdge[]>()
  const exclusive = new Map<number, QuestEdge[]>()
  for (const e of edges) {
    if (e.kind === 'exclusive') {
      push(exclusive, e.source, e)
      push(exclusive, e.target, e)
    } else {
      push(out, e.source, e)
      push(inn, e.target, e)
    }
  }
  return { quests, edges, out, in: inn, exclusive }
}

/** Number of quests this quest unlocks / needs (progression edges only). */
export function unlockCount(g: QuestGraph, id: number): number {
  return (g.out.get(id) ?? []).filter((e) => PROGRESSION_KINDS.has(e.kind)).length
}

export function requireCount(g: QuestGraph, id: number): number {
  return (g.in.get(id) ?? []).filter((e) => PROGRESSION_KINDS.has(e.kind)).length
}
