import { describe, expect, it } from 'vitest'
import { buildGraph } from '../src/graph/build'
import { buildView, questTree, type ViewOptions } from '../src/graph/subgraph'
import type { Quest } from '../src/types'

const q = (id: number, extra: Partial<Quest> = {}): Quest => ({
  id,
  name: `Q${id}`,
  level: 5,
  reqLevel: 1,
  zone: 'Northshire Valley',
  faction: 'A',
  classes: 0,
  starters: [],
  preAll: [],
  preAny: [],
  exclusiveTo: [],
  repeatable: false,
  ...extra,
})

// Real Northshire/Westfall shapes from the Forever DB.
const quests = [
  q(783),
  q(7, { preAny: [783] }),
  q(18, { preAny: [783] }),
  q(15, { preAny: [7] }),
  q(21, { preAny: [15] }),
  q(12, { zone: 'Westfall' }),
  q(13, { zone: 'Westfall', preAny: [12] }),
  q(14, { zone: 'Westfall', preAny: [13] }),
  q(50, { preAll: [14, 21] }),
  q(60, { exclusiveTo: [61] }),
  q(61, { exclusiveTo: [60] }),
  q(70),
]
const g = buildGraph(quests)
const edge = (s: number, t: number) => g.edges.find((e) => e.source === s && e.target === t)!

const opts: ViewOptions = {
  zone: 'Northshire Valley',
  dungeon: null,
  focus: null,
  faction: 'all',
  minLevel: 0,
  maxLevel: 100,
  hideUnlinked: false,
  onlyNonLinear: false,
  collapseChains: false,
  showExclusive: true,
  playerClass: 0,
  hideOtherClasses: false,
  expanded: new Set(),
}

describe('buildGraph', () => {
  it('marks a quest unlocking several others as branching unlocks', () => {
    expect(edge(783, 7)).toMatchObject({ kind: 'requires-any', chain: false })
    expect(edge(783, 18)).toMatchObject({ kind: 'requires-any', chain: false })
  })

  it('marks 1-to-1 links as plain chain links', () => {
    expect(edge(7, 15).chain).toBe(true)
    expect(edge(15, 21).chain).toBe(true)
    expect(edge(12, 13).chain).toBe(true)
  })

  it('marks quests needing several prerequisites as unlocks', () => {
    expect(edge(14, 50)).toMatchObject({ kind: 'requires-all', chain: false })
    expect(edge(21, 50).chain).toBe(false)
    expect(edge(13, 14).chain).toBe(true)
  })

  it('stores exclusive links once', () => {
    expect(g.edges.filter((e) => e.kind === 'exclusive')).toHaveLength(1)
  })
})

describe('buildView', () => {
  it('shows a zone plus linked quests from elsewhere as external', () => {
    const v = buildView(g, opts)
    const ids = v.nodes.map((n) => n.id).sort()
    expect(ids).toEqual(['14', '15', '18', '21', '50', '60', '61', '7', '70', '783'].sort())
    expect(v.nodes.find((n) => n.id === '14')!.external).toBe(true)
  })

  it('can hide unlinked quests and keep only non-linear links', () => {
    expect(buildView(g, { ...opts, hideUnlinked: true }).nodes.map((n) => n.id)).not.toContain('70')
    const v = buildView(g, { ...opts, onlyNonLinear: true, showExclusive: false })
    expect(v.nodes.map((n) => n.id).sort()).toEqual(['14', '18', '21', '50', '7', '783'].sort())
  })

  it('collapses runs of chain links into one node', () => {
    const v = buildView(g, { ...opts, zone: 'Westfall', collapseChains: true })
    const group = v.nodes.find((n) => n.members)!
    expect(group.members!.map((m) => m.id)).toEqual([12, 13, 14])
    expect(v.edges.find((e) => e.target === '50')!.source).toBe('chain:12')
  })

  it('focus mode shows full ancestor and descendant tree', () => {
    expect([...questTree(g, 15)].sort((a, b) => a - b)).toEqual([7, 15, 21, 50, 783])
  })
})

describe('class filtering', () => {
  const cg = buildGraph([
    q(1),
    q(2, { classes: 1, preAny: [1] }), // Warrior
    q(3, { classes: 128, preAny: [1] }), // Mage
    q(4, { classes: 1 | 128 }),
  ])
  const ids = (o: Partial<ViewOptions>) => buildView(cg, { ...opts, ...o }).nodes.map((n) => n.quest.id).sort()

  it('keeps everything when no class is chosen, even with the hide option on', () => {
    expect(ids({ hideOtherClasses: true })).toEqual([1, 2, 3, 4])
  })

  it("hides other classes' quests when asked", () => {
    expect(ids({ playerClass: 1, hideOtherClasses: true })).toEqual([1, 2, 4])
    expect(ids({ playerClass: 1 })).toEqual([1, 2, 3, 4])
  })

  it('highlights quests for the chosen class only', () => {
    const v = buildView(cg, { ...opts, playerClass: 1 })
    const forClass = v.nodes.filter((n) => n.forClass).map((n) => n.quest.id).sort()
    expect(forClass).toEqual([2, 4])
  })
})

describe('dungeon view', () => {
  const dg = buildGraph([
    q(100, { zone: 'Elwynn Forest', level: 10 }),
    q(101, { zone: 'Westfall', level: 14, preAny: [100] }),
    q(102, { zone: 'The Deadmines', level: 20, preAny: [101] }),
    q(103, { zone: 'Westfall', level: 21, preAny: [102] }),
    q(104, { zone: 'The Deadmines', level: 22, faction: 'H' }),
    q(105, { zone: 'Westfall', level: 14 }), // unrelated
    q(106, { zone: 'Stormwind City', level: 20, dungeon: 'The Deadmines' }),
  ])
  const view = (o: Partial<ViewOptions>) =>
    buildView(dg, { ...opts, zone: null, dungeon: 'The Deadmines', ...o })

  it("shows the dungeon's quests with their full lead-in and follow-up chains", () => {
    const v = view({})
    expect(v.nodes.map((n) => n.quest.id).sort()).toEqual([100, 101, 102, 103, 104, 106])
    expect(v.nodes.filter((n) => n.external).map((n) => n.quest.id).sort()).toEqual([100, 101, 103])
  })

  it('applies the level filter to dungeon quests but not to their chains', () => {
    expect(view({ minLevel: 18 }).nodes.map((n) => n.quest.id).sort()).toEqual([100, 101, 102, 103, 104, 106])
  })

  it('applies the faction filter', () => {
    expect(view({ faction: 'A' }).nodes.map((n) => n.quest.id).sort()).toEqual([100, 101, 102, 103, 106])
  })

  it('keeps standalone dungeon quests even when hiding unlinked quests', () => {
    const ids = view({ hideUnlinked: true, onlyNonLinear: true }).nodes.map((n) => n.quest.id)
    expect(ids).toContain(104)
    expect(ids).toContain(106)
  })
})
