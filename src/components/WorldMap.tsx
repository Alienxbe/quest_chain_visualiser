import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { levelText } from '../map/labels'
import type { WorldMapData, ZoneLevels } from '../types'

interface Props {
  world: WorldMapData
  levels: Map<number, ZoneLevels>
  /** Zone to fly to; a new object each time, so picking the same zone again works. */
  target: { areaId: number } | null
}

/** Zoom levels past the most detailed tiles (they're magnified). */
const OVERZOOM = 2
/** A zone counts as "zoomed into" once its box covers this much of the view. */
const OPEN_ZONE = 0.45
const BLANK_TILE = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='

const HOVER_STYLE: L.PathOptions = { stroke: true, color: '#f0d27a', weight: 2, opacity: 0.95, fillColor: '#f0d27a', fillOpacity: 0.12 }
const IDLE_STYLE: L.PathOptions = { stroke: false, fillOpacity: 0 }

/** Terrain tiles; tiles the importer didn't write (open sea) are left blank instead of 404ing. */
class TerrainLayer extends L.TileLayer {
  private present: Map<number, Set<string>>
  constructor(url: string, present: Record<number, string[]>, options: L.TileLayerOptions) {
    super(url, options)
    this.present = new Map(Object.entries(present).map(([z, keys]) => [Number(z), new Set(keys)]))
  }
  getTileUrl(coords: L.Coords): string {
    return this.present.get(coords.z)?.has(`${coords.x}_${coords.y}`) ? super.getTileUrl(coords) : BLANK_TILE
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

interface Label {
  marker: L.Marker
  /** Estimated size in px, for overlap checks. */
  w: number
  h: number
  latlng: L.LatLng
}

export function WorldMap({ world, levels, target }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const zoneBounds = useRef(new Map<number, L.LatLngBounds>())

  useEffect(() => {
    if (!el.current) return
    const map = L.map(el.current, {
      crs: L.CRS.Simple,
      minZoom: 0,
      maxZoom: world.maxZoom + OVERZOOM,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 100,
      attributionControl: false,
      zoomControl: false,
    })
    mapRef.current = map
    L.control.zoom({ position: 'bottomright' }).addTo(map)

    const px = world.cellSize
    const toLatLng = (x: number, y: number) => map.unproject([x * px, y * px], world.maxZoom)
    const [ex0, ey0, ex1, ey1] = world.extent
    const extent = L.latLngBounds(toLatLng(ex0, ey0), toLatLng(ex1, ey1))
    map.setMaxBounds(extent.pad(0.15))
    // Fit the zones, not the whole terrain grid (which includes stray far-off islets).
    const land = world.zones.length
      ? world.zones.reduce((b, z) => b.extend(toLatLng(z.bounds[0], z.bounds[1])).extend(toLatLng(z.bounds[2], z.bounds[3])),
        L.latLngBounds(toLatLng(world.zones[0].bounds[0], world.zones[0].bounds[1]), toLatLng(world.zones[0].bounds[0], world.zones[0].bounds[1])))
      : extent
    map.fitBounds(land, { padding: [16, 16] })
    map.setMinZoom(Math.min(map.getZoom(), map.getBoundsZoom(extent)) - 0.5)

    new TerrainLayer(`${import.meta.env.BASE_URL}data/terrain/${world.id}/{z}/{x}_{y}.webp`, world.tiles, {
      tileSize: world.tileSize,
      minNativeZoom: 0,
      maxNativeZoom: world.maxZoom,
      maxZoom: world.maxZoom + OVERZOOM,
      noWrap: true,
      bounds: extent,
    }).addTo(map)

    // ---- zone outlines: invisible until hovered ----
    zoneBounds.current = new Map()
    for (const zone of world.zones) {
      const rings = zone.rings.map((r) => {
        const pts: L.LatLng[] = []
        for (let i = 0; i < r.length; i += 2) pts.push(toLatLng(r[i], r[i + 1]))
        return pts
      })
      const bounds = L.latLngBounds(toLatLng(zone.bounds[0], zone.bounds[1]), toLatLng(zone.bounds[2], zone.bounds[3]))
      zoneBounds.current.set(zone.areaId, bounds)
      const range = zone.city ? undefined : levelText(levels.get(zone.areaId))
      const poly = L.polygon(rings, { ...IDLE_STYLE, className: 'zone-shape' }).addTo(map)
      poly.bindTooltip(
        `<strong>${escapeHtml(zone.name)}</strong>${range ? `<span class="tt-range">Level ${range}</span>` : ''}`,
        { sticky: true, direction: 'top', offset: [0, -12], className: 'zone-tooltip', opacity: 1 },
      )
      poly.on('mouseover', () => poly.setStyle(HOVER_STYLE))
      poly.on('mouseout', () => poly.setStyle(IDLE_STYLE))
      poly.on('click', () => map.flyToBounds(bounds, { padding: [24, 24], duration: 0.6 }))
    }

    // ---- labels: zone names, or subzone names inside zones you've zoomed into ----
    const labelLayer = L.layerGroup().addTo(map)
    const zoneLabels = new Map<number, Label>()
    const subLabels = new Map<number, Label[]>()
    const makeLabel = (html: string, className: string, x: number, y: number, w: number, h: number): Label => {
      const latlng = toLatLng(x, y)
      const marker = L.marker(latlng, {
        icon: L.divIcon({ html, className: `map-label ${className}`, iconSize: [w, h], iconAnchor: [w / 2, h / 2] }),
        interactive: false,
        keyboard: false,
      })
      return { marker, w, h, latlng }
    }
    for (const zone of world.zones) {
      const range = zone.city ? undefined : levelText(levels.get(zone.areaId))
      const html = `<span class="zl-name">${escapeHtml(zone.name)}</span>${range ? `<span class="zl-range">${range}</span>` : ''}`
      const w = zone.name.length * (zone.city ? 6.6 : 7.8) + 12
      zoneLabels.set(zone.areaId, makeLabel(html, zone.city ? 'zone city' : 'zone', zone.x, zone.y, w, range ? 34 : 18))
      subLabels.set(zone.areaId, zone.subzones.map((s) =>
        makeLabel(escapeHtml(s.name), 'subzone', s.x, s.y, s.name.length * 6.6 + 14, 20)))
    }

    // Labels are placed greedily (biggest zones and subzones first) and skipped where
    // they'd overlap one already placed; zooming in makes room for them.
    const place = () => {
      const size = map.getSize()
      const view = L.bounds([-60, -30], [size.x + 60, size.y + 30])
      const taken: L.Bounds[] = []
      const shown = new Set<L.Layer>()
      const tryPlace = (l: Label) => {
        const p = map.latLngToContainerPoint(l.latlng)
        if (!view.contains(p)) return
        const box = L.bounds([p.x - l.w / 2, p.y - l.h / 2], [p.x + l.w / 2, p.y + l.h / 2])
        if (taken.some((t) => t.intersects(box))) return
        taken.push(box)
        shown.add(l.marker)
      }
      for (const zone of world.zones) {
        const b = zoneBounds.current.get(zone.areaId)!
        const tl = map.latLngToContainerPoint(b.getNorthWest())
        const br = map.latLngToContainerPoint(b.getSouthEast())
        const open = br.x - tl.x > size.x * OPEN_ZONE || br.y - tl.y > size.y * OPEN_ZONE
        if (open) subLabels.get(zone.areaId)!.forEach(tryPlace)
        else if (br.x - tl.x > 40) tryPlace(zoneLabels.get(zone.areaId)!)
      }
      labelLayer.eachLayer((m) => { if (!shown.has(m)) labelLayer.removeLayer(m) })
      for (const m of shown) if (!labelLayer.hasLayer(m)) labelLayer.addLayer(m)
    }
    place()
    map.on('zoomend moveend resize', place)

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [world, levels])

  useEffect(() => {
    const b = target && zoneBounds.current.get(target.areaId)
    if (b) mapRef.current?.flyToBounds(b, { padding: [24, 24], duration: 0.8 })
  }, [target, world])

  return <div className="world-map" ref={el} />
}
