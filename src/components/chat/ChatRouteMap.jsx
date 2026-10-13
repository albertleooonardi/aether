import React, { useEffect, useRef, useState } from 'react';
import { MapPin, Flag, Maximize2 } from 'lucide-react';
import {
  LEVEL,
  ALT_ROUTE_COLOR,
  segmentsOf,
  segmentStroke,
  rainGradient,
  rainBreakpoints,
  breakpointHtml,
} from '../../utils/RouteLevels';
import { enableSmoothWheelZoom } from '../../utils/SmoothZoom';

// RainViewer's free radar tiles only exist up to z7; above that it serves a
// "Zoom Level Not Supported" placeholder image instead of a transparent tile.
const RADAR_MAX_NATIVE_ZOOM = 7;

const RAINVIEWER_INDEX = 'https://api.rainviewer.com/public/weather-maps.json';

// Inline mini-map for a chat route reply: the selected route is painted per
// stretch by the rain sampled there, alternatives sit faded behind it, and a
// radar overlay sits on top. `onOpenInMap` hands the same route to the app's
// full map page.
const ChatRouteMap = ({ data, onOpenInMap }) => {
  const el = useRef(null);
  const mapRef = useRef(null);
  const routeLayer = useRef(null);
  const [ready, setReady] = useState(!!window.L);
  const [selected, setSelected] = useState(data.bestIndex);

  useEffect(() => {
    if (window.L) return setReady(true);
    let n = 0;
    const id = setInterval(() => {
      if (window.L) {
        setReady(true);
        clearInterval(id);
      } else if (++n > 25) clearInterval(id);
    }, 200);
    return () => clearInterval(id);
  }, []);

  // Build the map once. Redrawing routes must not tear this down, or every
  // selection would reset the pan and zoom.
  useEffect(() => {
    const L = window.L;
    if (!ready || !L || !el.current || mapRef.current) return;

    enableSmoothWheelZoom(L);
    const map = L.map(el.current, {
      zoomControl: false,
      attributionControl: false,
      // Continuous zoom: zoomSnap 0 allows fractional levels, and the stock
      // wheel handler — which jumps in discrete steps per wheel event — is
      // replaced with the rAF-eased SmoothWheelZoom glide.
      zoomSnap: 0,
      zoomDelta: 0.4,
      scrollWheelZoom: false,
      smoothWheelZoom: true,
      smoothSensitivity: 1.2,
    });
    mapRef.current = map;

    // CARTO now requires an API key and serves a watermarked tile without erroring;
    // Esri's Dark Gray Canvas is the keyless replacement. Path is {z}/{y}/{x}, and
    // coverage stops at z16 over Indonesia — hence maxNativeZoom, so Leaflet upscales
    // rather than tiling the map with "Map data not yet available" placeholders.
    L.tileLayer(
      'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19, maxNativeZoom: 16, attribution: 'Esri · © OpenStreetMap contributors' }
    ).addTo(map);

    // Radar overlay (best-effort; may be unavailable on some networks).
    (async () => {
      try {
        const res = await fetch(RAINVIEWER_INDEX);
        const idx = await res.json();
        const past = idx.radar?.past || [];
        if (past.length && mapRef.current) {
          const p = past[past.length - 1];
          // maxNativeZoom stops Leaflet requesting tiles past RainViewer's z7
          // ceiling — it upscales the z7 tile instead of tiling the map with
          // "Zoom Level Not Supported" placeholders. Radar is coarse by nature,
          // so an upscaled tile is the real resolution, not a downgrade.
          L.tileLayer(`${idx.host}${p.path}/256/{z}/{x}/{y}/4/1_1.png`, {
            opacity: 0.45,
            zIndex: 400,
            maxNativeZoom: RADAR_MAX_NATIVE_ZOOM,
            maxZoom: 19,
          }).addTo(map);
        }
      } catch {
        /* ignore */
      }
    })();

    return () => {
      map.remove();
      mapRef.current = null;
      routeLayer.current = null;
    };
  }, [ready]);

  // Redraw whenever the pick changes.
  useEffect(() => {
    const L = window.L;
    const map = mapRef.current;
    if (!ready || !L || !map) return;

    if (routeLayer.current) routeLayer.current.remove();
    const group = L.layerGroup().addTo(map);
    routeLayer.current = group;

    // Alternatives first so the selected route always sits on top.
    data.routes.forEach((r, i) => {
      if (i === selected) return;
      L.polyline(r.coordinates, { color: ALT_ROUTE_COLOR, weight: 3, opacity: 0.35, lineJoin: 'round' }).addTo(group);
    });

    // The selected route, one coloured stretch per sampled chunk. Chunks share a
    // boundary vertex, so the pieces join seamlessly.
    const sel = data.routes[selected];
    segmentsOf(sel).forEach((s) => {
      const lvl = LEVEL[s.level] || LEVEL.unknown;
      const line = L.polyline(sel.coordinates.slice(s.from, s.to + 1), {
        // Green at 0% chance of rain through to red at 100%. This map always
        // draws on the dark basemap.
        color: segmentStroke(s, 'dark'),
        // "No data" also breaks the line, so absence is never colour-alone.
        ...(lvl.dashed ? { dashArray: '7 9' } : {}),
        weight: 6,
        opacity: 0.95,
        lineJoin: 'round',
        lineCap: 'round',
      }).addTo(group);
      // Each stretch was judged at its own arrival time — show that, so the
      // verdict can be checked rather than taken on faith.
      if (s.at) {
        const when = new Date(s.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        const chance = typeof s.chance === 'number' ? ` · ${s.chance}% rain` : '';
        line.bindTooltip(`~${when}${chance}`, { sticky: true, direction: 'top' });
      }
    });

    // Where the chance of rain changes. The chat map is small, so fewer marks.
    rainBreakpoints(sel, { maxMarks: 4, minDelta: 10 }).forEach((m) => {
      L.marker([m.lat, m.lon], {
        icon: L.divIcon({ className: '', html: breakpointHtml(m, 'dark'), iconSize: [0, 0] }),
        keyboard: false,
        interactive: false,
      }).addTo(group);
    });

    const dot = (color) =>
      L.divIcon({
        className: '',
        html: `<div style="width:12px;height:12px;border-radius:9999px;background:${color};border:2px solid #fff"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
    L.marker([data.origin.lat, data.origin.lon], { icon: dot('#38bdf8') }).addTo(group);
    L.marker([data.dest.lat, data.dest.lon], { icon: dot('#fb923c') }).addTo(group);

    map.fitBounds(L.latLngBounds(sel.coordinates), { padding: [24, 24] });
  }, [ready, data, selected]);

  const shown = data.routes[selected];
  const legend = [...new Set(segmentsOf(shown).map((s) => s.level))];

  return (
    <div className="mt-2.5 overflow-hidden rounded-2xl border border-ink/[0.1]">
      {/* Endpoints */}
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-ink/70">
        <MapPin size={13} className="shrink-0 text-sky-300" />
        {/* min-w-0 is what lets `truncate` work inside a flex row; the destination gets the
            larger share because it is the name the user cares about. */}
        <span className="min-w-0 flex-1 truncate" title={data.origin.name}>{data.origin.name}</span>
        <span className="shrink-0 text-ink/30">→</span>
        <Flag size={13} className="shrink-0 text-orange-300" />
        <span className="min-w-0 flex-[1.6] truncate" title={data.dest.name}>{data.dest.name}</span>
      </div>

      {/* The button floats over the map (not in the endpoints row, where it starved the names).
          Top-right: zoomControl is off, so no Leaflet control lives there. z-[1000] clears Leaflet's
          panes (up to 700) and controls (800); the min-h/px keep a usable touch target. */}
      <div className="relative">
        <div ref={el} className="h-44 w-full" />
        {onOpenInMap && (
          <button
            onClick={() => onOpenInMap(data)}
            title="Open on the full map page"
            className="absolute right-2 top-2 z-[1000] flex min-h-[30px] items-center gap-1 rounded-full bg-panel/85 px-2.5 py-1 text-[10px] font-semibold text-ink/80 shadow backdrop-blur transition hover:bg-panel hover:text-ink"
          >
            <Maximize2 size={11} /> Open in map
          </button>
        )}
      </div>

      {/* Route summary — tap a row to draw that alternative instead. */}
      <div className="space-y-1 p-2">
        {data.routes.map((r, i) => {
          const lv = LEVEL[r.rain.level] || LEVEL.dry;
          const isSelected = i === selected;
          const isBest = i === data.bestIndex;
          return (
            <button
              key={i}
              type="button"
              aria-pressed={isSelected}
              onClick={() => setSelected(i)}
              className={`flex w-full min-w-0 items-center gap-2 rounded-xl px-2 py-1.5 text-left text-xs transition ${
                isSelected ? 'bg-ink/[0.08] text-ink' : 'text-ink/55 hover:bg-ink/[0.05] hover:text-ink/80'
              }`}
            >
              {/* Rule: anything that samples the drawn map line (this dot, the legend swatches) uses
                  `stroke` on a dark chip; anything that is panel TEXT (the badge below) uses `ink`.
                  `ink` here made a `light` route the same hex the legend labels "Dry". */}
              <span className="inline-flex shrink-0 items-center rounded-full bg-slate-900/90 p-0.5 ring-1 ring-ink/15">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: isSelected ? segmentStroke({ level: r.rain.level, chance: r.rain.chance }, 'dark') : ALT_ROUTE_COLOR }}
                />
              </span>
              <span className="min-w-0 flex-1 truncate">
                {isBest ? 'Recommended' : `Option ${i + 1}`}
                <span className="text-ink/40"> · {r.distanceKm.toFixed(1)} km</span>
              </span>
              <span className="tabular shrink-0 font-semibold">{Math.round(r.durationMin)} min</span>
              <span
                className="ml-1 shrink-0 rounded-full px-1.5 py-0.5 text-[10px]"
                style={{ background: `${lv.ink}22`, color: lv.ink }}
              >
                {lv.label}
                {typeof r.rain.chance === 'number' && r.rain.level !== 'unknown' && ` · ${r.rain.chance}%`}
              </span>
            </button>
          );
        })}

        {/* What the colours along the drawn line mean: one continuous ramp. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pt-1 text-[10px] text-ink/45">
          <span className="flex items-center gap-1.5">
            <span>0%</span>
            <span className="inline-flex items-center rounded-full bg-slate-900/90 px-1 py-0.5 ring-1 ring-ink/15">
              <span className="inline-block h-1.5 w-14 rounded-full" style={{ background: rainGradient('dark') }} />
            </span>
            <span>100% chance of rain</span>
          </span>
          {legend.includes('unknown') && <span>Dashed: no forecast</span>}
        </div>

        <p className="px-1 pt-1 text-[11px] leading-snug text-ink/45">
          {shown.rain.level === 'unknown'
            ? "Couldn't reach the weather service to check this route."
            : shown.rain.level === 'dry'
            ? `No rain forecast at any of ${shown.rain.samples} points along the route` +
              (typeof shown.rain.chance === 'number' ? ` (avg ${shown.rain.chance}%).` : '.')
            : `Rain forecast at ${shown.rain.rainy}/${shown.rain.samples} points along the route.`}
          {shown.arriveAt && (
            <>
              {' '}
              Arrive ~{new Date(shown.arriveAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              <span className="text-ink/30"> · excl. live traffic</span>
            </>
          )}
        </p>
      </div>
    </div>
  );
};

export default ChatRouteMap;
