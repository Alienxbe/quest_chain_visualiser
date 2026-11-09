import { useEffect, useMemo, useState } from 'react'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { QuestGraph as Graph } from '../graph/build'
import { CLASS_COLOURS } from '../config'
import { requireCount, unlockCount } from '../graph/build'
import { GROUP_HEIGHT, layoutView, NODE_HEIGHT, NODE_WIDTH, type Positions } from '../graph/layout'
import type { View, ViewEdge, ViewNode } from '../graph/subgraph'

export interface NodeData extends Record<string, unknown> {
  view: ViewNode
  unlocks: number
  needs: number
  selected: boolean
  classColour?: string
}

type QuestFlowNode = Node<NodeData>

function QuestNode({ data }: NodeProps<QuestFlowNode>) {
  const { view, unlocks, needs, selected, classColour } = data
  const q = view.quest
  const classes = [
    'quest-node',
    `faction-${q.faction}`,
    view.external && 'external',
    view.focused && 'focused',
    view.forClass && 'for-class',
    selected && 'selected',
  ].filter(Boolean).join(' ')
  return (
    <div className={classes} style={classStyle(classColour)} title={q.objective}>
      <Handle type="target" position={Position.Left} />
      <div className="qn-title">
        <span className="qn-level">{q.level || '?'}</span>
        <span className="qn-name">{q.name}</span>
      </div>
      <div className="qn-meta">
        <span className="qn-sub">{view.external ? q.zone : q.starters[0] ?? `#${q.id}`}</span>
        {needs > 1 && <span className="badge needs" title="Needs several quests">needs {needs}</span>}
        {unlocks > 1 && <span className="badge unlocks" title="Unlocks several quests">unlocks {unlocks}</span>}
        {view.forClass && <span className="badge class-badge" title="Quest for your class">class</span>}
        {q.repeatable && <span className="badge" title="Repeatable">↻</span>}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function ChainNode({ data }: NodeProps<QuestFlowNode>) {
  const members = data.view.members!
  const first = members[0]
  const last = members[members.length - 1]
  const cls = `quest-node chain-node faction-${first.faction}${data.view.forClass ? ' for-class' : ''}`
  return (
    <div className={cls} style={classStyle(data.classColour)}>
      <Handle type="target" position={Position.Left} />
      <div className="qn-title">
        <span className="qn-level">{first.level}–{last.level}</span>
        <span className="qn-name">{first.name}</span>
      </div>
      <div className="qn-chain">⋯ {members.length} quests in a row ⋯</div>
      <div className="qn-meta">
        <span className="qn-sub">→ {last.name}</span>
        <span className="badge">click to expand</span>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function classStyle(colour: string | undefined): React.CSSProperties {
  return colour
    ? ({ width: NODE_WIDTH, '--class-colour': colour } as React.CSSProperties)
    : { width: NODE_WIDTH }
}

const nodeTypes = { quest: QuestNode, chain: ChainNode }

const EDGE_COLOURS = {
  chain: 'var(--edge-chain)',
  unlock: 'var(--edge-unlock)',
  breadcrumb: 'var(--edge-breadcrumb)',
  conditional: 'var(--edge-conditional)',
  exclusive: 'var(--edge-exclusive)',
}

function toFlowEdge(e: ViewEdge, g: Graph): Edge {
  let colour = e.chain ? EDGE_COLOURS.chain : EDGE_COLOURS.unlock
  let dash: string | undefined
  let label: string | undefined
  let width = e.chain ? 1.5 : 2.5
  const target = g.quests.get(Number(e.target))

  switch (e.kind) {
    case 'requires-all':
      if (target && target.preAll.length > 1) label = 'AND'
      break
    case 'requires-any':
      if (target && target.preAny.length > 1) label = 'OR'
      break
    case 'breadcrumb':
      colour = EDGE_COLOURS.breadcrumb
      dash = '2 5'
      label = 'breadcrumb'
      width = 2
      break
    case 'parent-active':
      colour = EDGE_COLOURS.conditional
      dash = '7 5'
      label = 'while active'
      break
    case 'starting-with':
      colour = EDGE_COLOURS.conditional
      dash = '7 5'
      label = 'once accepted'
      break
    case 'exclusive':
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'straight',
        label: 'either/or',
        style: { stroke: EDGE_COLOURS.exclusive, strokeDasharray: '4 4', strokeWidth: 1.5 },
        labelStyle: { fill: EDGE_COLOURS.exclusive, fontSize: 10 },
        labelBgStyle: { fill: 'var(--panel)' },
        zIndex: 0,
      }
  }
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    label,
    style: { stroke: colour, strokeWidth: width, strokeDasharray: dash },
    labelStyle: { fill: colour, fontSize: 10, fontWeight: 700 },
    labelBgStyle: { fill: 'var(--panel)' },
    markerEnd: { type: MarkerType.ArrowClosed, color: colour, width: 16, height: 16 },
    zIndex: e.chain ? 1 : 2,
  }
}

interface Props {
  graph: Graph
  view: View
  playerClass: number
  selected: number | null
  onSelect: (id: number) => void
  onFocus: (id: number) => void
  onExpand: (groupId: string) => void
}

const layoutCache = new Map<string, Positions>()

export function QuestGraph({ graph, view, playerClass, selected, onSelect, onFocus, onExpand }: Props) {
  const [positions, setPositions] = useState<Positions | null>(null)
  const [layoutError, setLayoutError] = useState<string | null>(null)

  const key = useMemo(
    () => view.nodes.map((n) => n.id).join(',') + '|' + view.edges.map((e) => e.id).join(','),
    [view],
  )

  useEffect(() => {
    let cancelled = false
    const cached = layoutCache.get(key)
    if (cached) {
      setPositions(cached)
      return
    }
    setPositions(null)
    layoutView(view)
      .then((p) => {
        layoutCache.set(key, p)
        if (!cancelled) setPositions(p)
      })
      .catch((err) => !cancelled && setLayoutError(String(err)))
    return () => {
      cancelled = true
    }
  }, [key, view])

  const nodes: QuestFlowNode[] = useMemo(() => {
    if (!positions) return []
    return view.nodes.map((n) => ({
      id: n.id,
      type: n.members ? 'chain' : 'quest',
      position: positions.get(n.id) ?? { x: 0, y: 0 },
      width: NODE_WIDTH,
      height: n.members ? GROUP_HEIGHT : NODE_HEIGHT,
      data: {
        view: n,
        unlocks: n.members ? 0 : unlockCount(graph, n.quest.id),
        needs: n.members ? 0 : requireCount(graph, n.quest.id),
        selected: !n.members && n.quest.id === selected,
        classColour: n.forClass ? CLASS_COLOURS[playerClass] : undefined,
      },
      draggable: true,
      connectable: false,
    }))
  }, [positions, view, graph, selected, playerClass])

  const edges = useMemo(() => (positions ? view.edges.map((e) => toFlowEdge(e, graph)) : []), [positions, view, graph])

  if (layoutError) return <div className="empty">Layout failed: {layoutError}</div>
  if (!view.nodes.length) return <div className="empty">No quests match these filters.</div>

  return (
    <>
      {!positions && <div className="empty overlay">Laying out {view.nodes.length} quests…</div>}
      {positions && <ReactFlow
        // Remount per layout so fitView applies to each new view. Nodes carry explicit
        // sizes, so fitting works even for off-screen nodes that are never measured.
        key={key}
        fitView
        fitViewOptions={{ padding: 0.08, maxZoom: 1.1 }}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, n) => {
          const v = (n.data as NodeData).view
          if (v.members) onExpand(v.id)
          else onSelect(v.quest.id)
        }}
        onNodeDoubleClick={(_, n) => {
          const v = (n.data as NodeData).view
          if (!v.members) onFocus(v.quest.id)
        }}
        minZoom={0.05}
        maxZoom={2}
        onlyRenderVisibleElements
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background gap={24} color="var(--grid)" />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => {
            const d = n.data as NodeData
            if (d.classColour) return d.classColour
            const f = d.view.quest.faction
            return f === 'A' ? 'var(--alliance)' : f === 'H' ? 'var(--horde)' : 'var(--neutral)'
          }}
          maskColor="rgba(0,0,0,0.6)"
        />
      </ReactFlow>}
    </>
  )
}

