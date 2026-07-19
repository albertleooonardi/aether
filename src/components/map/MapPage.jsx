import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Search,
  Navigation,
  MapPin,
  Flag,
  Clock,
  X,
  Loader2,
  CloudRain,
  Route as RouteIcon,
  Wind,
  Droplets,
  Umbrella,
  Crosshair,
} from 'lucide-react';
import CITIES from './cities';
import { LEVEL, segmentsOf } from '../../utils/RouteLevels';
import { enableSmoothWheelZoom } from '../../utils/SmoothZoom';
import { getWeatherIcon } from '../../utils/WeatherIcons';
import { fetchCurrent, fetchWeatherByCoords } from '../../services/WeatherService';
import { geocode, geocodeCandidates } from '../../services/GeoService';
import { getRoutesWithRain } from '../../services/RouteService';

// RainViewer's free radar tiles only exist up to z7; above that it serves a
// "Zoom Level Not Supported" placeholder image instead of a transparent tile.
const RADAR_MAX_NATIVE_ZOOM = 7;
const RAINVIEWER_INDEX = 'https://api.rainviewer.com/public/weather-maps.json';

// One WeatherAPI call per visible city — keep results warm for a while.
const CITY_CACHE_MS = 10 * 60 * 1000;
const MAX_VISIBLE_CITIES = 14;

// Classify a WeatherAPI condition into a marker style. "Event" classes (rain,
// thunder, snow) get loud colours so bad weather pops out of the map the way
// traffic jams pop out of Google Maps.
const classify = (text, isDay) => {
  const t = (text || '').toLowerCase();
  if (t.includes('thunder')) return { key: 'thunder', emoji: '⛈️', bg: '#7c3aed', event: true };
  if (t.includes('snow') || t.includes('blizzard') || t.includes('sleet') || t.includes('ice'))
    return { key: 'snow', emoji: '🌨️', bg: '#0891b2', event: true };
  if (t.includes('drizzle') || t.includes('light rain'))
    return { key: 'drizzle', emoji: '🌦️', bg: '#0284c7', event: true };
  if (t.includes('rain') || t.includes('shower')) return { key: 'rain', emoji: '🌧️', bg: '#2563eb', event: true };
  if (t.includes('mist') || t.includes('fog') || t.includes('haze'))
    return { key: 'fog', emoji: '🌫️', bg: '#334155', event: false };
  if (t.includes('sunny') || t.includes('clear'))
    return { key: 'clear', emoji: isDay ? '☀️' : '🌙', bg: '#1f2937', event: false };
  return { key: 'cloud', emoji: '☁️', bg: '#1f2937', event: false };
};

// Which curated cities deserve a marker at this zoom.
const rankLimit = (zoom) => (zoom < 4 ? 0 : zoom < 5.5 ? 1 : 2);

// Shape a forecast.json response into the detail-panel model.
const toDetail = (data) => {
  const c = data.current;
  const l = data.location;
  const today = data.forecast?.forecastday?.[0];
  const now = l.localtime_epoch;
  const hours = (data.forecast?.forecastday || [])
    .flatMap((d) => d.hour || [])
    .filter((h) => h.time_epoch >= now - 3600)
    .slice(0, 6)
    .map((h) => ({
      time: h.time.slice(-5),
      temp: Math.round(h.temp_c),
      cond: h.condition.text,
      isDay: h.is_day,
      rain: h.chance_of_rain ?? 0,
    }));
  return {
    name: l.name,
    region: [l.region, l.country].filter(Boolean).join(', '),
    lat: l.lat,
    lon: l.lon,
    temp: Math.round(c.temp_c),
    feels: Math.round(c.feelslike_c),
    cond: c.condition.text,
    isDay: c.is_day,
    humidity: c.humidity,
    wind: Math.round(c.wind_kph),
    uv: c.uv,
    rainChance: today?.day?.daily_chance_of_rain ?? 0,
    high: today ? Math.round(today.day.maxtemp_c) : null,
    low: today ? Math.round(today.day.mintemp_c) : null,
    hours,
  };
};

/*
 * Full-page interactive weather map: live event markers over curated cities,
 * click-anywhere conditions, a RainViewer radar overlay, and Google-Maps-style
 * directions where each stretch of road is coloured by the rain forecast at the
 * time you'd actually drive it. The chat can push a route it computed straight
 * onto this map via `initialRoute`.
 */
const MapPage = ({ weather, visible = true, initialRoute, onRouteShown }) => {
  const el = useRef(null);
  const mapRef = useRef(null);
  const markerLayer = useRef(null);
  const routeLayer = useRef(null);
  const pinMarker = useRef(null);
  const radarLayer = useRef(null);
  const radarUrl = useRef(null);
  const cityCache = useRef(new Map()); // name → { at, wx }
  const fetchTick = useRef(0);
  const detailRef = useRef(null); // latest openDetail, for Leaflet handlers

  const [ready, setReady] = useState(!!window.L);
  const [radarOn, setRadarOn] = useState(true);
  const [cityWx, setCityWx] = useState({}); // name → { temp, cond, isDay }
  const [mode, setMode] = useState('explore'); // 'explore' | 'directions'
  const [q, setQ] = useState('');
  const [originText, setOriginText] = useState('');
  const [destText, setDestText] = useState('');
  const [cands, setCands] = useState(null); // { kind: 'explore'|'dest', list, origin? }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null); // { loading, place, wx }
  const [route, setRoute] = useState(null); // { origin, dest, routes, bestIndex }
  const [selRoute, setSelRoute] = useState(0);

  /* ---------------- map bootstrap ---------------- */
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

    const center = weather && Number.isFinite(weather.lat) ? [weather.lat, weather.lon] : [-2.5, 118];
    enableSmoothWheelZoom(L);
    const map = L.map(el.current, {
      zoomControl: false,
      attributionControl: true,
      // Continuous zoom: fractional levels allowed, and the stock steppy wheel
      // handler is swapped for the rAF-eased SmoothWheelZoom glide.
      zoomSnap: 0,
      zoomDelta: 0.4,
      scrollWheelZoom: false,
      smoothWheelZoom: true,
      smoothSensitivity: 1.2,
    }).setView(center, weather ? 9 : 4.5);
    mapRef.current = map;

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap · © CARTO',
    }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    markerLayer.current = L.layerGroup().addTo(map);

    // Anywhere on the basemap is a valid question: "what's the weather here?"
    map.on('click', (e) => detailRef.current?.({ name: null, lat: e.latlng.lat, lon: e.latlng.lng }));

    return () => {
      map.remove();
      mapRef.current = null;
      markerLayer.current = null;
      routeLayer.current = null;
      pinMarker.current = null;
      radarLayer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Coming back to a tab that was hidden: the container was 0×0 while display:none,
  // so Leaflet must re-measure or tiles render in the wrong place.
  useEffect(() => {
    if (visible) setTimeout(() => mapRef.current?.invalidateSize(), 50);
  }, [visible]);

  /* ---------------- radar overlay ---------------- */
  useEffect(() => {
    const L = window.L;
    const map = mapRef.current;
    if (!ready || !L || !map) return;

    let cancelled = false;
    (async () => {
      if (!radarOn) {
        radarLayer.current?.remove();
        radarLayer.current = null;
        return;
      }
      if (!radarUrl.current) {
        try {
          const idx = await (await fetch(RAINVIEWER_INDEX)).json();
          const past = idx.radar?.past || [];
          if (past.length) radarUrl.current = `${idx.host}${past[past.length - 1].path}/256/{z}/{x}/{y}/4/1_1.png`;
        } catch {
          /* radar is best-effort */
        }
      }
      if (cancelled || !radarUrl.current || radarLayer.current) return;
      radarLayer.current = L.tileLayer(radarUrl.current, {
        opacity: 0.5,
        zIndex: 400,
        maxNativeZoom: RADAR_MAX_NATIVE_ZOOM,
        maxZoom: 19,
      }).addTo(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, radarOn]);

  /* ---------------- weather-event markers over curated cities ---------------- */
  const refreshCities = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    const tick = ++fetchTick.current;
    const bounds = map.getBounds().pad(0.15);
    const zoom = map.getZoom();
    const maxRank = rankLimit(zoom);
    const center = map.getCenter();

    const visible = CITIES.filter((c) => c.r <= maxRank && bounds.contains([c.lat, c.lon]))
      .sort(
        (a, b) =>
          (a.lat - center.lat) ** 2 + (a.lon - center.lng) ** 2 - ((b.lat - center.lat) ** 2 + (b.lon - center.lng) ** 2)
      )
      .slice(0, MAX_VISIBLE_CITIES);

    const results = await Promise.all(
      visible.map(async (c) => {
        const hit = cityCache.current.get(c.n);
        if (hit && Date.now() - hit.at < CITY_CACHE_MS) return [c.n, hit.wx];
        try {
          const data = await fetchCurrent(`${c.lat},${c.lon}`);
          const wx = {
            temp: Math.round(data.current.temp_c),
            cond: data.current.condition.text,
            isDay: data.current.is_day,
          };
          cityCache.current.set(c.n, { at: Date.now(), wx });
          return [c.n, wx];
        } catch {
          return null;
        }
      })
    );
    if (tick !== fetchTick.current) return; // a newer pan superseded this pass
    setCityWx(Object.fromEntries(results.filter(Boolean)));
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    refreshCities();
    let t;
    const onMove = () => {
      clearTimeout(t);
      t = setTimeout(refreshCities, 600);
    };
    map.on('moveend zoomend', onMove);
    return () => {
      clearTimeout(t);
      map.off('moveend zoomend', onMove);
    };
  }, [ready, refreshCities]);

  // Redraw the marker pills whenever fresh weather lands.
  useEffect(() => {
    const L = window.L;
    const layer = markerLayer.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers();

    Object.entries(cityWx).forEach(([name, wx]) => {
      const city = CITIES.find((c) => c.n === name);
      if (!city) return;
      const cls = classify(wx.cond, wx.isDay);
      const html = `
        <div style="display:flex;align-items:center;gap:5px;padding:3px 9px 3px 6px;border-radius:9999px;
          background:${cls.event ? cls.bg : 'rgba(23,26,31,0.92)'};
          border:1px solid ${cls.event ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.14)'};
          box-shadow:0 4px 14px rgba(0,0,0,0.45);white-space:nowrap;
          font:600 11px Montserrat,system-ui,sans-serif;color:#fff;">
          <span style="font-size:13px;line-height:1">${cls.emoji}</span>${wx.temp}°
        </div>`;
      const marker = L.marker([city.lat, city.lon], {
        icon: L.divIcon({ className: '', html, iconSize: null, iconAnchor: [24, 12] }),
        zIndexOffset: cls.event ? 500 : 0,
      });
      marker.on('click', () => detailRef.current?.({ name, lat: city.lat, lon: city.lon }));
      marker.addTo(layer);
    });
  }, [ready, cityWx]);

  /* ---------------- click-for-detail panel ---------------- */
  const openDetail = useCallback(async (place) => {
    setCands(null);
    setDetail({ loading: true, place });
    try {
      const data = await fetchWeatherByCoords(place.lat, place.lon);
      const wx = toDetail(data);
      setDetail({ loading: false, place: { ...place, name: place.name || wx.name }, wx });

      const L = window.L;
      const map = mapRef.current;
      if (L && map) {
        pinMarker.current?.remove();
        pinMarker.current = L.marker([place.lat, place.lon], {
          icon: L.divIcon({ className: '', html: '<div class="rc-pulse"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }),
        }).addTo(map);
      }
    } catch {
      setDetail({ loading: false, place, wx: null });
    }
  }, []);
  detailRef.current = openDetail;

  const closeDetail = () => {
    setDetail(null);
    pinMarker.current?.remove();
    pinMarker.current = null;
  };

  /* ---------------- search (explore) ---------------- */
  const mapCenter = () => {
    const c = mapRef.current?.getCenter();
    return c ? { lat: c.lat, lon: c.lng } : null;
  };

  const selectPlace = (place) => {
    setCands(null);
    mapRef.current?.flyTo([place.lat, place.lon], Math.max(mapRef.current.getZoom(), 11), { duration: 0.8 });
    openDetail(place);
  };

  const handleExplore = async (e) => {
    e.preventDefault();
    const text = q.trim();
    if (!text || busy) return;
    setBusy(true);
    setError('');
    try {
      const list = await geocodeCandidates(text, mapCenter());
      if (!list.length) return setError(`Couldn't find “${text}”.`);
      if (list.length === 1) return selectPlace(list[0]);
      setCands({ kind: 'explore', list });
    } finally {
      setBusy(false);
    }
  };

  /* ---------------- directions ---------------- */
  const runRoute = useCallback(async (originLoc, destLoc) => {
    setBusy(true);
    setError('');
    setCands(null);
    try {
      const result = await getRoutesWithRain(originLoc, destLoc, Date.now());
      setRoute({ origin: originLoc, dest: destLoc, routes: result.routes, bestIndex: result.bestIndex });
      setSelRoute(result.bestIndex);
      closeDetail();
    } catch (err) {
      setError(
        err.code === 'no_route'
          ? `No driving route between ${originLoc.name} and ${destLoc.name}.`
          : 'Could not fetch directions right now.'
      );
    } finally {
      setBusy(false);
    }
  }, []);

  const handleDirections = async (e) => {
    e.preventDefault();
    if (busy) return;
    const destQ = destText.trim();
    if (!destQ) return;
    setBusy(true);
    setError('');
    try {
      const here = mapCenter();
      const originLoc = originText.trim()
        ? await geocode(originText.trim(), here)
        : weather && Number.isFinite(weather.lat)
        ? { name: weather.city, lat: weather.lat, lon: weather.lon }
        : null;
      if (!originLoc) {
        return setError(originText.trim() ? `Couldn't find “${originText}”.` : 'Type a starting point (or search a city on the Weather page first).');
      }
      const list = await geocodeCandidates(destQ, originLoc);
      if (!list.length) return setError(`Couldn't find “${destQ}”.`);
      if (list.length === 1) return await runRoute(originLoc, list[0]);
      setCands({ kind: 'dest', list, origin: originLoc });
    } finally {
      setBusy(false);
    }
  };

  const clearRoute = () => {
    setRoute(null);
    routeLayer.current?.remove();
    routeLayer.current = null;
    onRouteShown?.();
  };

  // Route pushed in from the chatbot.
  useEffect(() => {
    if (!initialRoute) return;
    setMode('directions');
    setOriginText(initialRoute.origin?.name || '');
    setDestText(initialRoute.dest?.name || '');
    setRoute(initialRoute);
    setSelRoute(initialRoute.bestIndex ?? 0);
  }, [initialRoute]);

  // Draw the current route selection; refit only when the route itself changes.
  const lastFitted = useRef(null);
  useEffect(() => {
    const L = window.L;
    const map = mapRef.current;
    if (!ready || !L || !map) return;
    routeLayer.current?.remove();
    if (!route) return;

    const group = L.layerGroup().addTo(map);
    routeLayer.current = group;

    route.routes.forEach((r, i) => {
      if (i === selRoute) return;
      const alt = L.polyline(r.coordinates, { color: '#94a3b8', weight: 3, opacity: 0.35, lineJoin: 'round' });
      alt.on('click', () => setSelRoute(i));
      alt.addTo(group);
    });

    const sel = route.routes[selRoute];
    segmentsOf(sel).forEach((s) => {
      const line = L.polyline(sel.coordinates.slice(s.from, s.to + 1), {
        color: (LEVEL[s.level] || LEVEL.unknown).color,
        weight: 6,
        opacity: 0.95,
        lineJoin: 'round',
        lineCap: 'round',
      }).addTo(group);
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
    L.marker([route.origin.lat, route.origin.lon], { icon: dot('#38bdf8') }).addTo(group);
    L.marker([route.dest.lat, route.dest.lon], { icon: dot('#fb923c') }).addTo(group);

    if (lastFitted.current !== route) {
      lastFitted.current = route;
      map.fitBounds(L.latLngBounds(route.routes[route.bestIndex].coordinates), { padding: [60, 60] });
    }
  }, [ready, route, selRoute]);

  const locate = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude, longitude } = pos.coords;
      mapRef.current?.flyTo([latitude, longitude], 11, { duration: 0.8 });
      openDetail({ name: null, lat: latitude, lon: longitude });
    });
  };

  const shown = route?.routes[selRoute];
  const legend = shown ? [...new Set(segmentsOf(shown).map((s) => s.level))] : [];

  return (
    <div className="relative h-[calc(100dvh-140px)] min-h-[480px] overflow-hidden rounded-3xl glass">
      <div ref={el} className="absolute inset-0 z-0" />

      {!ready && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <Loader2 size={28} className="animate-spin text-white/60" />
        </div>
      )}

      {/* ---------- search / directions panel ---------- */}
      <div className="absolute left-3 top-3 z-20 w-[min(340px,calc(100%-1.5rem))]">
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-neutral-900/90 shadow-2xl backdrop-blur-xl">
          {/* mode tabs */}
          <div className="flex gap-1 p-2 pb-0">
            {[
              { id: 'explore', label: 'Explore', icon: Search },
              { id: 'directions', label: 'Directions', icon: Navigation },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => {
                  setMode(id);
                  setCands(null);
                  setError('');
                }}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                  mode === id ? 'bg-white/15 text-white' : 'text-white/50 hover:bg-white/5 hover:text-white/80'
                }`}
              >
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>

          {mode === 'explore' ? (
            <form onSubmit={handleExplore} className="flex items-center gap-2 p-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search a place…"
                className="w-full rounded-xl bg-white/5 px-3 py-2 text-base text-white placeholder-white/40 outline-none sm:text-sm"
              />
              <button
                type="submit"
                disabled={busy}
                aria-label="Search"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-slate-900 transition-transform active:scale-95 disabled:opacity-50"
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
              </button>
            </form>
          ) : (
            <form onSubmit={handleDirections} className="space-y-2 p-2">
              <div className="flex items-center gap-2 rounded-xl bg-white/5 px-3">
                <MapPin size={13} className="shrink-0 text-sky-300" />
                <input
                  value={originText}
                  onChange={(e) => setOriginText(e.target.value)}
                  placeholder={weather ? `From: ${weather.city}` : 'From…'}
                  className="w-full bg-transparent py-2 text-base text-white placeholder-white/40 outline-none sm:text-sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <div className="flex flex-1 items-center gap-2 rounded-xl bg-white/5 px-3">
                  <Flag size={13} className="shrink-0 text-orange-300" />
                  <input
                    value={destText}
                    onChange={(e) => setDestText(e.target.value)}
                    placeholder="To…"
                    className="w-full bg-transparent py-2 text-base text-white placeholder-white/40 outline-none sm:text-sm"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  aria-label="Find route"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-slate-900 transition-transform active:scale-95 disabled:opacity-50"
                >
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <Navigation size={15} />}
                </button>
              </div>
            </form>
          )}

          {error && <p className="px-3 pb-2 text-[11px] text-amber-300/90">{error}</p>}

          {/* geocode candidates — “which one did you mean?” */}
          {cands && (
            <div className="max-h-52 space-y-1 overflow-y-auto border-t border-white/10 p-2">
              {cands.list.map((c) => (
                <button
                  key={`${c.lat},${c.lon}`}
                  onClick={() => (cands.kind === 'explore' ? selectPlace(c) : runRoute(cands.origin, c))}
                  className="flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left text-xs text-white/75 transition hover:bg-white/10 hover:text-white"
                >
                  <MapPin size={13} className="mt-0.5 shrink-0 text-white/35" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{c.name}</span>
                    {c.label && c.label !== c.name && (
                      <span className="block truncate text-white/45">{c.label}</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* route options — like Google Maps' alternatives list */}
        {route && (
          <div className="mt-2 overflow-hidden rounded-2xl border border-white/10 bg-neutral-900/90 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-white/70">
              <MapPin size={13} className="shrink-0 text-sky-300" />
              <span className="truncate">{route.origin.name}</span>
              <span className="text-white/30">→</span>
              <Flag size={13} className="shrink-0 text-orange-300" />
              <span className="truncate">{route.dest.name}</span>
              <button
                onClick={clearRoute}
                aria-label="Clear route"
                className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-white/50 hover:bg-white/10 hover:text-white"
              >
                <X size={13} />
              </button>
            </div>
            <div className="space-y-1 px-2 pb-2">
              {route.routes.map((r, i) => {
                const lv = LEVEL[r.rain.level] || LEVEL.dry;
                const isSel = i === selRoute;
                return (
                  <button
                    key={i}
                    onClick={() => setSelRoute(i)}
                    aria-pressed={isSel}
                    className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs transition ${
                      isSel ? 'bg-white/10 text-white' : 'text-white/55 hover:bg-white/5 hover:text-white/80'
                    }`}
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: isSel ? lv.color : '#94a3b8' }} />
                    <RouteIcon size={12} className="shrink-0" />
                    <span className="flex-1 truncate">
                      {i === route.bestIndex ? 'Recommended' : `Option ${i + 1}`} · {r.distanceKm.toFixed(1)} km
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
              {legend.length > 1 && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pt-1 text-[10px] text-white/45">
                  <span>Along the road:</span>
                  {legend.map((l) => (
                    <span key={l} className="flex items-center gap-1">
                      <span className="h-1.5 w-3 rounded-full" style={{ background: (LEVEL[l] || LEVEL.unknown).color }} />
                      {(LEVEL[l] || LEVEL.unknown).label}
                    </span>
                  ))}
                </div>
              )}
              {shown?.arriveAt && (
                <p className="px-1 pb-1 text-[10px] text-white/40">
                  Leaving now, arriving ~
                  {new Date(shown.arriveAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · times
                  exclude live traffic
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ---------- radar + locate controls ---------- */}
      <div className="absolute right-3 top-3 z-20 flex flex-col gap-2">
        <button
          onClick={() => setRadarOn((r) => !r)}
          title={radarOn ? 'Hide rain radar' : 'Show rain radar'}
          className={`flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 shadow-xl backdrop-blur-xl transition ${
            radarOn ? 'bg-sky-500/80 text-white' : 'bg-neutral-900/90 text-white/60 hover:text-white'
          }`}
        >
          <CloudRain size={17} />
        </button>
        <button
          onClick={locate}
          title="My location"
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-neutral-900/90 text-white/60 shadow-xl backdrop-blur-xl transition hover:text-white"
        >
          <Crosshair size={17} />
        </button>
      </div>

      {/* ---------- weather detail panel ---------- */}
      {detail && (
        <div className="absolute bottom-0 left-0 right-0 z-20 sm:bottom-auto sm:left-auto sm:right-3 sm:top-16 sm:w-80">
          <div className="rounded-t-2xl border border-white/10 bg-neutral-900/95 p-4 shadow-2xl backdrop-blur-xl sm:rounded-2xl">
            {detail.loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={22} className="animate-spin text-white/60" />
              </div>
            ) : !detail.wx ? (
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm text-white/70">Couldn't load weather for this spot.</p>
                <button onClick={closeDetail} aria-label="Close" className="text-white/50 hover:text-white">
                  <X size={16} />
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold text-white">{detail.place.name}</h3>
                    <p className="truncate text-[11px] text-white/45">{detail.wx.region}</p>
                  </div>
                  <button onClick={closeDetail} aria-label="Close" className="shrink-0 text-white/50 hover:text-white">
                    <X size={16} />
                  </button>
                </div>

                <div className="mt-3 flex items-center gap-3">
                  {getWeatherIcon(detail.wx.cond, 40, detail.wx.isDay)}
                  <div>
                    <div className="text-3xl font-semibold text-white">{detail.wx.temp}°</div>
                    <div className="text-xs text-white/55">
                      {detail.wx.cond} · feels {detail.wx.feels}°
                    </div>
                  </div>
                  {detail.wx.high != null && (
                    <div className="ml-auto text-right text-xs text-white/55">
                      H {detail.wx.high}° <br /> L {detail.wx.low}°
                    </div>
                  )}
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px] text-white/70">
                  <div className="rounded-xl bg-white/5 px-2 py-1.5">
                    <Umbrella size={12} className="mx-auto mb-0.5 opacity-70" />
                    {detail.wx.rainChance}% rain
                  </div>
                  <div className="rounded-xl bg-white/5 px-2 py-1.5">
                    <Wind size={12} className="mx-auto mb-0.5 opacity-70" />
                    {detail.wx.wind} km/h
                  </div>
                  <div className="rounded-xl bg-white/5 px-2 py-1.5">
                    <Droplets size={12} className="mx-auto mb-0.5 opacity-70" />
                    {detail.wx.humidity}%
                  </div>
                </div>

                {detail.wx.hours.length > 0 && (
                  <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto">
                    {detail.wx.hours.map((h) => (
                      <div key={h.time} className="flex shrink-0 flex-col items-center gap-0.5 rounded-xl bg-white/5 px-2.5 py-1.5">
                        <span className="text-[10px] text-white/45">{h.time}</span>
                        {getWeatherIcon(h.cond, 16, h.isDay)}
                        <span className="text-[11px] font-medium text-white">{h.temp}°</span>
                        <span className="text-[9px] text-sky-300/80">{h.rain}%</span>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  onClick={() => {
                    const dest = { name: detail.place.name, lat: detail.place.lat, lon: detail.place.lon };
                    const origin =
                      weather && Number.isFinite(weather.lat)
                        ? { name: weather.city, lat: weather.lat, lon: weather.lon }
                        : null;
                    setMode('directions');
                    setDestText(dest.name || '');
                    if (origin) runRoute(origin, dest);
                    else setError('Type a starting point to route here.');
                  }}
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-slate-900 transition-transform active:scale-[0.98]"
                >
                  <Navigation size={13} /> Route here — check rain on the way
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ---------- legend ---------- */}
      <div className="absolute bottom-3 left-3 z-10 hidden items-center gap-3 rounded-full border border-white/10 bg-neutral-900/85 px-3 py-1.5 text-[10px] text-white/55 backdrop-blur-xl sm:flex">
        <span className="flex items-center gap-1"><span>🌧️</span> Raining</span>
        <span className="flex items-center gap-1"><span>⛈️</span> Storm</span>
        <span className="flex items-center gap-1"><span>🌨️</span> Snow</span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-4 rounded-full" style={{ background: 'linear-gradient(90deg,#22c55e,#eab308,#ef4444)' }} />
          Route rain
        </span>
      </div>
    </div>
  );
};

export default MapPage;
