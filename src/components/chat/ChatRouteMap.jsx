import React, { useEffect, useRef, useState } from 'react';
import { MapPin, Flag, Clock, Route as RouteIcon } from 'lucide-react';

const LEVEL = {
  dry: { color: '#22c55e', label: 'Dry' },
  light: { color: '#eab308', label: 'Light rain' },
  wet: { color: '#ef4444', label: 'Rain' },
};

const RAINVIEWER_INDEX = 'https://api.rainviewer.com/public/weather-maps.json';

// Inline mini-map for a chat route reply: draws each alternative coloured by rain
// risk (best highlighted), origin/destination markers, and a radar overlay.
const ChatRouteMap = ({ data }) => {
  const el = useRef(null);
  const mapRef = useRef(null);
  const [ready, setReady] = useState(!!window.L);

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

  useEffect(() => {
    const L = window.L;
    if (!ready || !L || !el.current || mapRef.current) return;

    const map = L.map(el.current, { zoomControl: false, attributionControl: false });
    mapRef.current = map;

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);

    // Draw non-best routes first (faded), then the best on top (bright).
    const order = data.routes
      .map((r, i) => i)
      .sort((a, b) => (a === data.bestIndex ? 1 : b === data.bestIndex ? -1 : 0));

    order.forEach((i) => {
      const r = data.routes[i];
      const isBest = i === data.bestIndex;
      const color = (LEVEL[r.rain.level] || LEVEL.dry).color;
      L.polyline(r.coordinates, {
        color: isBest ? color : '#94a3b8',
        weight: isBest ? 6 : 3,
        opacity: isBest ? 0.95 : 0.4,
        lineJoin: 'round',
      }).addTo(map);
    });

    const dot = (color) =>
      L.divIcon({
        className: '',
        html: `<div style="width:12px;height:12px;border-radius:9999px;background:${color};border:2px solid #fff"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
    L.marker([data.origin.lat, data.origin.lon], { icon: dot('#38bdf8') }).addTo(map);
    L.marker([data.dest.lat, data.dest.lon], { icon: dot('#fb923c') }).addTo(map);

    const best = data.routes[data.bestIndex];
    map.fitBounds(L.latLngBounds(best.coordinates), { padding: [24, 24] });

    // Radar overlay (best-effort; may be unavailable on some networks).
    (async () => {
      try {
        const res = await fetch(RAINVIEWER_INDEX);
        const idx = await res.json();
        const past = idx.radar?.past || [];
        if (past.length) {
          const p = past[past.length - 1];
          L.tileLayer(`${idx.host}${p.path}/256/{z}/{x}/{y}/4/1_1.png`, { opacity: 0.5, zIndex: 400 }).addTo(map);
        }
      } catch {
        /* ignore */
      }
    })();

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [ready, data]);

  const best = data.routes[data.bestIndex];

  return (
    <div className="mt-2 overflow-hidden rounded-2xl border border-white/10 bg-white/5">
      {/* Endpoints */}
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-white/70">
        <MapPin size={13} className="text-sky-300" />
        <span className="truncate">{data.origin.name}</span>
        <span className="text-white/30">→</span>
        <Flag size={13} className="text-orange-300" />
        <span className="truncate">{data.dest.name}</span>
      </div>

      <div ref={el} className="h-56 w-full" />

      {/* Route summary */}
      <div className="space-y-1.5 p-3">
        {data.routes.map((r, i) => {
          const lv = LEVEL[r.rain.level] || LEVEL.dry;
          const isBest = i === data.bestIndex;
          return (
            <div
              key={i}
              className={`flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs ${
                isBest ? 'bg-white/10 text-white' : 'text-white/55'
              }`}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: isBest ? lv.color : '#94a3b8' }} />
              <RouteIcon size={12} className="shrink-0" />
              <span className="flex-1">
                {isBest ? 'Recommended' : `Option ${i + 1}`} · {r.distanceKm.toFixed(1)} km
              </span>
              <Clock size={12} className="shrink-0 opacity-70" />
              <span>{Math.round(r.durationMin)} min</span>
              <span className="ml-1 rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: `${lv.color}22`, color: lv.color }}>
                {lv.label}
              </span>
            </div>
          );
        })}
        <p className="pt-1 text-[11px] text-white/45">
          {best.rain.level === 'dry'
            ? 'All sampled points look dry along the recommended route.'
            : `Rain sampled at ${best.rain.rainy}/${best.rain.samples} points on the driest route.`}
        </p>
      </div>
    </div>
  );
};

export default ChatRouteMap;
