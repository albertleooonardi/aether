import React, { useEffect, useRef, useState } from 'react';
import { MapPin, Flag, Clock, Route as RouteIcon, Maximize2 } from 'lucide-react';
import { LEVEL, segmentsOf } from '../../utils/RouteLevels';
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

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);

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
      L.polyline(r.coordinates, { color: '#94a3b8', weight: 3, opacity: 0.35, lineJoin: 'round' }).addTo(group);
    });

    // The selected route, one coloured stretch per sampled chunk. Chunks share a
    // boundary vertex, so the pieces join seamlessly.
    const sel = data.routes[selected];
    segmentsOf(sel).forEach((s) => {
      const line = L.polyline(sel.coordinates.slice(s.from, s.to + 1), {
        color: (LEVEL[s.level] || LEVEL.unknown).color,
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
    <div className="mt-2 overflow-hidden rounded-2xl border border-ink/10 bg-ink/5">
      {/* Endpoints */}
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-ink/70">
        <MapPin size={13} className="text-sky-300" />
        <span className="truncate">{data.origin.name}</span>
        <span className="text-ink/30">→</span>
        <Flag size={13} className="text-orange-300" />
        <span className="truncate">{data.dest.name}</span>
        {onOpenInMap && (
          <button
            onClick={() => onOpenInMap(data)}
            title="Open on the full map page"
            className="ml-auto flex shrink-0 items-center gap-1 rounded-lg bg-ink/10 px-2 py-1 text-[10px] font-medium text-ink/70 transition hover:bg-ink/20 hover:text-ink"
          >
            <Maximize2 size={11} /> Open in map
          </button>
        )}
      </div>

      <div ref={el} className="h-56 w-full" />

      {/* Route summary — tap a row to draw that alternative instead. */}
      <div className="space-y-1.5 p-3">
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
              className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs transition ${
                isSelected ? 'bg-ink/10 text-ink' : 'text-ink/55 hover:bg-ink/5 hover:text-ink/80'
              }`}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: isSelected ? lv.color : '#94a3b8' }}
              />
              <RouteIcon size={12} className="shrink-0" />
              <span className="flex-1 truncate">
                {isBest ? 'Recommended' : `Option ${i + 1}`} · {r.distanceKm.toFixed(1)} km
              </span>
              <Clock size={12} className="shrink-0 opacity-70" />
              <span>{Math.round(r.durationMin)} min</span>
              <span
                className="ml-1 shrink-0 rounded-full px-1.5 py-0.5 text-[10px]"
                style={{ background: `${lv.color}22`, color: lv.color }}
              >
                {lv.label}
              </span>
            </button>
          );
        })}

        {/* What the colours along the drawn line mean. */}
        {legend.length > 1 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-[10px] text-ink/45">
            <span>Along the road:</span>
            {legend.map((l) => (
              <span key={l} className="flex items-center gap-1">
                <span className="h-1.5 w-3 rounded-full" style={{ background: (LEVEL[l] || LEVEL.unknown).color }} />
                {(LEVEL[l] || LEVEL.unknown).label}
              </span>
            ))}
          </div>
        )}

        <p className="pt-1 text-[11px] text-ink/45">
          {shown.rain.level === 'unknown'
            ? 'Could not reach the weather service to check this route.'
            : shown.rain.level === 'dry'
            ? `No rain forecast at any of the ${shown.rain.samples} points along this route, at the times you'd pass them` +
              (typeof shown.rain.chance === 'number' ? ` (${shown.rain.chance}% average chance).` : '.')
            : `Rain forecast at ${shown.rain.rainy}/${shown.rain.samples} points along this route, at the times you'd pass them.`}
          {shown.arriveAt && (
            <>
              {' '}
              Arriving ~{new Date(shown.arriveAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              <span className="text-ink/30"> · times exclude live traffic</span>
            </>
          )}
        </p>
      </div>
    </div>
  );
};

export default ChatRouteMap;
