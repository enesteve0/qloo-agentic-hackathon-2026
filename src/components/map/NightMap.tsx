'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import { setWorkerUrl, type ExpressionSpecification, type FilterSpecification, type Map as MLMap } from 'maplibre-gl';
import ngeohash from 'ngeohash';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Map, { AttributionControl, Layer, NavigationControl, Source, type MapRef } from 'react-map-gl/maplibre';

/** Per-neighborhood display values keyed by 2020 NTA code. */
export interface NtaDisplay {
  multiplier: number;
  rank?: number;
}

export interface SelectedScreen {
  /** Index into public/geo/kiosks.min.json (same as Kiosk.i). */
  i: number;
  rank: number;
}

export interface NightMapProps {
  heat?: { gh: string; v: number }[];
  ntas?: Record<string, NtaDisplay>;
  selected?: SelectedScreen[];
  llmPicks?: string[];
  focusNta?: string | null;
  /** Outlines a neighborhood without moving the map (e.g. while its list row is hovered). */
  highlightNta?: string | null;
  onNtaClick?: (code: string) => void;
  showAllKiosks?: boolean;
  className?: string;
  ariaLabel?: string;
}

interface KioskFile {
  v: number;
  k: [lon: number, lat: number, isLink5g: 0 | 1][];
}

// Copied by scripts/copy-vendor.mjs; keep the version in sync with package.json.
setWorkerUrl('/vendor/maplibre-gl-worker-6.15.0.mjs');

const STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';
export const NYC_BOUNDS: [[number, number], [number, number]] = [
  [-74.26, 40.49],
  [-73.69, 40.92],
];
// Viridis stops for lift multipliers ≥1 (below baseline stays transparent).
const HEAT_COLOR: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['get', 'v'],
  1,
  '#3b528b',
  1.6,
  '#21918c',
  2.3,
  '#5ec962',
  3,
  '#fde725',
];

function squareImage(size: number, fill: string, stroke: string | null): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, size, size);
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, size - 2, size - 2);
  }
  return ctx.getImageData(0, 0, size, size);
}

/** Re-tints OpenFreeMap's near-black "dark" style so land, water, parks and streets read at night. */
function restyleBasemap(map: MLMap) {
  const paint: [layer: string, prop: Parameters<MLMap['setPaintProperty']>[1], value: string][] = [
    ['background', 'background-color', '#16181b'],
    ['water', 'fill-color', '#08090b'],
    ['landuse_residential', 'fill-color', '#17191c'],
    ['landcover_wood', 'fill-color', '#121b15'],
    ['landuse_park', 'fill-color', '#121c16'],
    ['building', 'fill-color', '#1c1f23'],
    ['highway_path', 'line-color', '#22252a'],
    ['highway_minor', 'line-color', '#25292e'],
    ['highway_major_casing', 'line-color', '#1a1d21'],
    ['highway_major_inner', 'line-color', '#2d3238'],
    ['highway_major_subtle', 'line-color', '#2d3238'],
    ['highway_motorway_casing', 'line-color', '#1a1d21'],
    ['highway_motorway_inner', 'line-color', '#363b42'],
    ['highway_motorway_subtle', 'line-color', '#363b42'],
    ['railway_transit', 'line-color', '#2a2e35'],
    ['railway', 'line-color', '#2a2e35'],
    ['water_name', 'text-color', '#33404f'],
    ['place_suburb', 'text-color', '#6b7078'],
    ['place_other', 'text-color', '#5b6068'],
    ['highway_name_other', 'text-color', '#4b5058'],
  ];
  for (const [layer, prop, value] of paint) {
    if (map.getLayer(layer)) map.setPaintProperty(layer, prop, value);
  }
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function NightMap({
  heat = [],
  ntas = {},
  selected = [],
  llmPicks = [],
  focusNta = null,
  highlightNta = null,
  onNtaClick,
  showAllKiosks = true,
  className,
  ariaLabel = 'Map of New York City street screens',
}: NightMapProps) {
  const mapRef = useRef<MapRef>(null);
  const [kiosks, setKiosks] = useState<KioskFile | null>(null);
  const [ntaGeo, setNtaGeo] = useState<GeoJSON.FeatureCollection | null>(null);
  // Overlay layers mount only after our square marker images are registered with the style.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void Promise.all([
      fetch('/geo/kiosks.min.json').then((r) => r.json() as Promise<KioskFile>),
      fetch('/geo/nta2020.min.geojson').then((r) => r.json() as Promise<GeoJSON.FeatureCollection>),
    ]).then(([k, n]) => {
      if (!alive) return;
      setKiosks(k);
      setNtaGeo(n);
    });
    return () => {
      alive = false;
    };
  }, []);

  const kioskGeo = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(
    () => ({
      type: 'FeatureCollection',
      features: (kiosks?.k ?? []).map(([lon, lat, t], i) => ({
        type: 'Feature',
        id: i,
        properties: { i, t },
        geometry: { type: 'Point', coordinates: [lon, lat] },
      })),
    }),
    [kiosks],
  );

  const selectedGeo = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(() => {
    const list = kiosks?.k ?? [];
    return {
      type: 'FeatureCollection',
      features: selected.flatMap((s) => {
        const k = list[s.i];
        if (!k) return [];
        return [{ type: 'Feature' as const, properties: { rank: s.rank }, geometry: { type: 'Point' as const, coordinates: [k[0], k[1]] } }];
      }),
    };
  }, [kiosks, selected]);

  const heatGeo = useMemo<GeoJSON.FeatureCollection<GeoJSON.Polygon>>(
    () => ({
      type: 'FeatureCollection',
      features: heat.map(({ gh, v }) => {
        const [minLat, minLon, maxLat, maxLon] = ngeohash.decode_bbox(gh);
        return {
          type: 'Feature',
          properties: { v },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [minLon, minLat],
                [maxLon, minLat],
                [maxLon, maxLat],
                [minLon, maxLat],
                [minLon, minLat],
              ],
            ],
          },
        };
      }),
    }),
    [heat],
  );

  const ntaFill = useMemo<ExpressionSpecification>(() => {
    const entries = Object.entries(ntas).filter(([, d]) => d.multiplier >= 1);
    if (entries.length === 0) return ['literal', 'rgba(0,0,0,0)'] as unknown as ExpressionSpecification;
    const match: unknown[] = ['match', ['get', 'code']];
    for (const [code, d] of entries) {
      match.push(code, d.multiplier);
    }
    match.push(0);
    return [
      'interpolate',
      ['linear'],
      match as ExpressionSpecification,
      0,
      'rgba(0,0,0,0)',
      0.999,
      'rgba(0,0,0,0)',
      1,
      '#3b528b',
      1.6,
      '#21918c',
      2.3,
      '#5ec962',
      3,
      '#fde725',
    ];
  }, [ntas]);

  const llmFilter = useMemo<FilterSpecification>(
    () => ['in', ['get', 'code'], ['literal', llmPicks]] as FilterSpecification,
    [llmPicks],
  );

  const onLoad = useCallback(() => {
    const map: MLMap | undefined = mapRef.current?.getMap();
    if (!map) return;
    restyleBasemap(map);
    if (!map.hasImage('kiosk')) map.addImage('kiosk', squareImage(6, 'rgba(166,169,174,0.75)', null));
    if (!map.hasImage('kiosk-selected')) map.addImage('kiosk-selected', squareImage(14, '#ffb547', '#0e0f11'));
    // On phones the expanded attribution covers the bottom of the map. Collapse it to its (i) button once the
    // map has rendered; the full credit stays one tap away and in every page footer.
    map.once('idle', () => {
      if (map.getContainer().clientWidth >= 640) return;
      map.getContainer().querySelector('.maplibregl-ctrl-attrib.maplibregl-compact-show')?.classList.remove('maplibregl-compact-show');
    });
    setReady(true);
  }, []);

  useEffect(() => {
    if (!focusNta || !ntaGeo) return;
    const f = ntaGeo.features.find((x) => (x.properties as { code?: string } | null)?.code === focusNta);
    if (!f) return;
    const coords = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [])
      .flat(2) as [number, number][];
    if (coords.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of coords) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    mapRef.current?.fitBounds(
      [
        [minX, minY],
        [maxX, maxY],
      ],
      { padding: 60, duration: prefersReducedMotion() ? 0 : 700, maxZoom: 14.5 },
    );
  }, [focusNta, ntaGeo]);

  return (
    <div className={className} role="region" aria-label={ariaLabel}>
      <Map
        ref={mapRef}
        mapStyle={STYLE_URL}
        initialViewState={{ longitude: -73.94, latitude: 40.705, zoom: 10.4 }}
        minZoom={9}
        maxZoom={17}
        maxBounds={[-74.6, 40.35, -73.4, 41.1]}
        attributionControl={false}
        canvasContextAttributes={{ preserveDrawingBuffer: true }}
        dragRotate={false}
        pitchWithRotate={false}
        onLoad={onLoad}
        interactiveLayerIds={onNtaClick ? ['nta-hit'] : []}
        onClick={(e) => {
          const code = (e.features?.[0]?.properties as { code?: string } | undefined)?.code;
          if (code && onNtaClick) onNtaClick(code);
        }}
        style={{ width: '100%', height: '100%' }}
      >
        <AttributionControl
          compact
          customAttribution='<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> · Kiosks: NYC Open Data · Taste: Qloo'
        />
        <NavigationControl position="top-right" showCompass={false} />

        {ready && (
          <Source id="mask" type="geojson" data="/geo/nyc-mask.geojson">
            {/* Dims everything outside the five boroughs so the city reads as the stage. */}
            <Layer id="nyc-mask" type="fill" paint={{ 'fill-color': '#0b0c0e', 'fill-opacity': 0.72 }} />
          </Source>
        )}

        {ready && ntaGeo && (
          <Source id="nta" type="geojson" data={ntaGeo}>
            <Layer id="nta-fill" type="fill" paint={{ 'fill-color': ntaFill, 'fill-opacity': 0.55 }} />
            <Layer id="nta-hit" type="fill" paint={{ 'fill-color': '#000', 'fill-opacity': 0 }} />
            <Layer id="nta-line" type="line" paint={{ 'line-color': '#3d424a', 'line-width': 1 }} />
            <Layer
              id="nta-llm"
              type="line"
              filter={llmFilter}
              paint={{ 'line-color': '#f2f0ea', 'line-width': 1.5, 'line-dasharray': [2, 2] }}
            />
            <Layer
              id="nta-hover"
              type="line"
              filter={['==', ['get', 'code'], highlightNta ?? '']}
              paint={{ 'line-color': '#f2f0ea', 'line-width': 2 }}
            />
            <Layer
              id="nta-focus"
              type="line"
              filter={['==', ['get', 'code'], focusNta ?? '']}
              paint={{ 'line-color': '#ffb547', 'line-width': 2.5 }}
            />
            <Layer
              id="nta-label"
              type="symbol"
              minzoom={12}
              layout={{
                'text-field': ['upcase', ['get', 'short']],
                'text-font': ['Noto Sans Bold'],
                'text-size': 11,
                'text-letter-spacing': 0.06,
              }}
              paint={{ 'text-color': '#a6a9ae', 'text-halo-color': '#0e0f11', 'text-halo-width': 1.2 }}
            />
          </Source>
        )}

        {ready && heat.length > 0 && (
          <Source id="heat" type="geojson" data={heatGeo}>
            <Layer id="heat-fill" type="fill" paint={{ 'fill-color': HEAT_COLOR, 'fill-opacity': 0.6 }} />
          </Source>
        )}

        {ready && showAllKiosks && kiosks && (
          <Source id="kiosks" type="geojson" data={kioskGeo}>
            <Layer
              id="kiosk-sq"
              type="symbol"
              layout={{
                'icon-image': 'kiosk',
                'icon-allow-overlap': true,
                'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 13, 0.9, 16, 1.5],
              }}
            />
          </Source>
        )}

        {ready && selected.length > 0 && (
          <Source id="selected" type="geojson" data={selectedGeo}>
            <Layer
              id="selected-sq"
              type="symbol"
              layout={{
                'icon-image': 'kiosk-selected',
                'icon-allow-overlap': true,
                'text-field': ['to-string', ['get', 'rank']],
                'text-font': ['Noto Sans Bold'],
                'text-size': 10,
                'text-offset': [0, 1.3],
                'text-allow-overlap': false,
              }}
              paint={{ 'text-color': '#ffb547', 'text-halo-color': '#0e0f11', 'text-halo-width': 1.2 }}
            />
          </Source>
        )}
      </Map>
    </div>
  );
}
