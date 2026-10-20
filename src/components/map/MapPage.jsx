import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Search,
  Navigation,
  MapPin,
  Flag,
  X,
  Loader2,
  Wind,
  Droplets,
  Umbrella,
  LocateFixed,
  Layers,
  Plus,
  Minus,
  ArrowUpDown,
  Pencil,
  Play,
  Pause,
  CloudRain,
  Thermometer,
  Tag,
  ArrowUpRight,
  Copy,
  Check,
  ChevronDown,
  MousePointerClick,
} from 'lucide-react';
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
import { getWeatherIcon } from '../../utils/WeatherIcons';
import { fetchWeatherByCoords } from '../../services/WeatherService';
import { getDevicePosition } from '../../services/Location';
import {
  geocode,
  geocodeCandidates,
  resolveMapsUrl,
  createSuggestTypeahead,
  pickIsCurrent,
  looksLikeUrl,
  placeSuggest,
} from '../../services/GeoService';
import { parseMapsUrl } from '../../chat/intents';
import { getRoutesWithRain } from '../../services/RouteService';
import { fetchCityConditions } from '../../services/CityWeather';
import { loadRecents, addRecent, removeRecent } from '../../services/RecentPlaces';
import { buildLocalGroups, mergeRemote, flatItems } from '../../utils/Suggestions';
import { CITIES } from '../../data/cities';
import SuggestionMenu, { useMenuNav } from '../search/SuggestionMenu';

// A search box is a different thing from the chat's "which one did you mean?"
// prompt: there, four options keep a disambiguation tap quick, but here people
// are scanning for their place and expect a real result list.
const SEARCH_RESULTS = 10;

// A dead end is the one moment the link escape hatch is worth explaining, so the
// failure names the way forward instead of just reporting the miss.
const NOT_FOUND = (what) => `Couldn't find “${what}”. Paste a Google Maps link and I'll use that exact spot.`;

// RainViewer's free radar tiles only exist up to z7; above that it serves a
// "Zoom Level Not Supported" placeholder image instead of a transparent tile.
const RADAR_MAX_NATIVE_ZOOM = 7;
const RAINVIEWER_INDEX = 'https://api.rainviewer.com/public/weather-maps.json';
const RADAR_OPACITY = 0.6;
const RADAR_STEP_MS = 650;

// Which overlays are on, remembered per browser.
const LAYERS_KEY = 'aether.mapLayers.v1';
const DEFAULT_LAYERS = { radar: true, temps: true, labels: true };
const loadLayers = () => {
  try {
    return { ...DEFAULT_LAYERS, ...(JSON.parse(localStorage.getItem(LAYERS_KEY)) || {}) };
  } catch {
    return DEFAULT_LAYERS;
  }
};

// The "click anywhere" hint shows until the first click on the map.
const HINT_KEY = 'aether.mapHint.v1';
const hintSeen = () => {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return true;
  }
};

// City temperature chips: tier-2 towns join once zoomed in this far, names
// appear from NAME_ZOOM, and never more than MAX_CHIPS at once.
const TIER2_ZOOM = 6.5;
const NAME_ZOOM = 5;
const MAX_CHIPS = 32;
const CHIP_W = 64; // px a temperature-only chip needs to itself
const CHIP_H = 30;

// Shape a forecast.json response into the detail-panel model.
const toDetail = (data) => {
  const c = data.current;
  const l = data.location;
  const today = data.forecast?.forecastday?.[0];
  const now = l.localtime_epoch;
  const hours = (data.forecast?.forecastday || [])
    .flatMap((d) => d.hour || [])
    .filter((h) => h.time_epoch >= now - 3600)
    .slice(0, 8)
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
    localtime: l.localtime,
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
 * Full-page interactive weather map: temperature chips over curated cities,
 * click-anywhere conditions, an animated RainViewer radar with a timeline, and
 * Google-Maps-style directions where each stretch of road is coloured by the
 * rain forecast at the time you'd actually drive it. The chat can push a route
 * it computed straight onto this map via `initialRoute`.
 */
// The basemap ships in matching light/dark variants, so the map flips with the
// app instead of staying a dark slab on a light page.
//
// CARTO put their basemaps behind an API key and now serve an "API KEY REQUIRED"
// watermark as the tile itself — with HTTP 200, so nothing errors, the map just
// reads as broken. Esri's Gray Canvas is the keyless replacement and has both a
// dark and a light variant, so the theme switch below still works.
//
// Two gotchas vs CARTO: the path is {z}/{y}/{x} (row before column), and there
// is no {r}/@2x retina tile.
const ESRI = 'https://services.arcgisonline.com/ArcGIS/rest/services';
// Plain grey canvas, used when place names are switched off. Real coverage
// over Indonesia stops at z16 — past that it returns a light-grey "Map data not
// yet available" placeholder — so it is upscaled from there (maxNativeZoom).
const CANVAS = {
  dark: `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
  light: `${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
};
const CANVAS_MAX_NATIVE_ZOOM = 16;
// Full street map with towns, roads and POI names built in, used when place
// names are on. A separate label overlay was tried first, but Esri's Canvas
// "Reference" layers (and every other keyless label layer) have holes: over
// Jakarta they serve an opaque grey "Map data not yet available" tile at z11–14
// that blanked the whole map. World Street Map has real tiles at z4–19
// everywhere tested; CSS turns it grey per theme (see .basemap-tiles).
const STREET = `${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`;
const STREET_MAX_NATIVE_ZOOM = 19;
const BASEMAP_ATTRIBUTION = 'Esri · HERE · Garmin · © OpenStreetMap contributors';

// Background of the legend chips: a miniature of the basemap the swatch samples, so
// `strokeOf(level, theme)` always sits on the ground it was tuned against. Dark =
// near-black like Esri Dark Gray; light = Esri Light Gray land (measured #efefef).
const CHIP_BG = { dark: 'rgba(15,23,42,0.9)', light: '#efefef' };

const fmtClock = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

const kindField = (kind) => (kind === 'explore' ? 'explore' : kind === 'origin' ? 'origin' : 'dest');

// Small temperature chip rendered (through a portal) inside a Leaflet marker.
const CityChip = ({ city, showName }) => (
  <div
    className="absolute left-0 top-0 flex w-max -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center gap-1.5 rounded-full border border-ink/10 bg-panel/90 py-1 pl-1.5 pr-2.5 text-[11px] font-semibold text-ink shadow-lg backdrop-blur transition-transform hover:scale-105"
    title={`${city.name} · ${city.wx.text}, ${city.wx.temp}°`}
  >
    {getWeatherIcon(city.wx.text, 14, city.wx.isDay)}
    <span className="tabular">{city.wx.temp}°</span>
    {showName && <span className="font-medium text-ink/55">{city.name}</span>}
  </div>
);

const Toggle = ({ on }) => (
  <span
    aria-hidden="true"
    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
      on ? 'bg-accent' : 'bg-ink/15'
    }`}
  >
    <span
      className={`absolute h-4 w-4 rounded-full shadow transition-transform ${
        on ? 'translate-x-[18px] bg-accentFg' : 'translate-x-0.5 bg-panel'
      }`}
    />
  </span>
);

// Phone layout (below Tailwind's sm breakpoint), tracked live so rotating or
// resizing switches between the bottom-sheet and side-panel layouts.
const NARROW_QUERY = '(max-width: 639px)';
// Wide but short: a phone on its side, where floating panels compete for height.
const SHORT_QUERY = '(min-width: 640px) and (max-height: 520px)';
const useMedia = (query) => {
  const get = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches;
  const [match, setMatch] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [query]);
  return match;
};

const MapPage = ({ weather, theme = 'dark', visible = true, initialRoute, onRouteShown, onOpenWeather }) => {
  const el = useRef(null);
  const mapRef = useRef(null);
  const panelRef = useRef(null);
  const exploreInput = useRef(null);
  const originInput = useRef(null);
  const destInput = useRef(null);
  const routeLayer = useRef(null);
  const pinMarker = useRef(null);
  const meLayer = useRef(null); // "you are here" dot + accuracy ring
  // Set once the person drags, scrolls or clicks the map, so a late location
  // fix never yanks the view away from where they are looking.
  const userTouched = useRef(false);
  const routeRef = useRef(null);
  const baseLayer = useRef(null);
  const radarHost = useRef(null);
  const radarLayers = useRef(new Map()); // frame path -> tile layer
  const chipGroup = useRef(null);
  const chipMarkers = useRef(new Map()); // city key -> { marker, el }
  const detailRef = useRef(null); // latest openDetail, for Leaflet handlers
  const typeahead = useRef(createSuggestTypeahead({ source: placeSuggest })).current; // Explore box as-you-type (Google via proxy, else Photon)
  // Origin and destination each need their own debounce/AbortController — a
  // shared instance would let typing in one field cancel an in-flight lookup
  // for the other.
  const originTypeahead = useRef(createSuggestTypeahead({ source: placeSuggest })).current;
  const destTypeahead = useRef(createSuggestTypeahead({ source: placeSuggest })).current;
  // Which input the user last typed in. A typeahead result may only touch `cands` if
  // its own field is still the one being edited — see applySuggestions.
  const activeField = useRef(null); // 'explore' | 'origin' | 'dest' | null
  // The place picked from a suggestion, kept next to the exact text it wrote
  // into the field (see pickIsCurrent) so submit can use the chosen pin
  // instead of re-geocoding the string — and so an edit after picking drops it.
  const originPick = useRef(null); // { text, place } | null
  const destPick = useRef(null);

  const [ready, setReady] = useState(!!window.L);
  const [layers, setLayers] = useState(loadLayers);
  const [layersOpen, setLayersOpen] = useState(false);
  const [mode, setMode] = useState('explore'); // 'explore' | 'directions'
  const [q, setQ] = useState('');
  const [originText, setOriginText] = useState('');
  const [destText, setDestText] = useState('');
  const [cands, setCands] = useState(null); // { kind: 'explore'|'origin'|'dest-suggest'|'dest', list, origin?, submitted? }
  const [menuField, setMenuField] = useState(null); // which input's menu is open
  const [searching, setSearching] = useState(false); // a typeahead request is in flight
  const [recents, setRecents] = useState(loadRecents);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null); // { loading, place, wx }
  const [copied, setCopied] = useState(false);
  const [route, setRoute] = useState(null); // { origin, dest, routes, bestIndex }
  routeRef.current = route;
  const [myPos, setMyPos] = useState(null); // device location { lat, lon, acc }
  const [selRoute, setSelRoute] = useState(0);
  const [routeOpen, setRouteOpen] = useState(true);
  const [viewport, setViewport] = useState(null); // { lat, lon, zoom } after each move
  const [frames, setFrames] = useState([]); // radar frames [{ time, path }]
  const [frameIdx, setFrameIdx] = useState(0);
  const [latestIdx, setLatestIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [radarTick, setRadarTick] = useState(0); // bumps to refresh the frame index
  const [chips, setChips] = useState([]); // cities with current conditions
  const [chipEls, setChipEls] = useState([]); // [key, element] for portals
  const [showHint, setShowHint] = useState(() => !hintSeen());
  const narrow = useMedia(NARROW_QUERY); // phone layout
  const short = useMedia(SHORT_QUERY); // landscape phone
  const [sheetExpanded, setSheetExpanded] = useState(false); // phone weather sheet: peek or full
  const [formCollapsed, setFormCollapsed] = useState(false); // phone: directions form folded to one line
  const sheetTouch = useRef(null);

  const setLayer = (id, on) =>
    setLayers((prev) => {
      const next = { ...prev, [id]: on };
      try {
        localStorage.setItem(LAYERS_KEY, JSON.stringify(next));
      } catch {
        /* not persisting is fine */
      }
      return next;
    });

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

  // A tab switch or unmount must not leave a debounced Photon request free to
  // resolve later and stamp stale suggestions onto whatever's on screen next.
  useEffect(
    () => () => {
      typeahead.cancel();
      originTypeahead.cancel();
      destTypeahead.cancel();
    },
    [typeahead, originTypeahead, destTypeahead]
  );

  useEffect(() => {
    const L = window.L;
    if (!ready || !L || !el.current || mapRef.current) return;

    const center = weather && Number.isFinite(weather.lat) ? [weather.lat, weather.lon] : [-2.5, 118];
    enableSmoothWheelZoom(L);
    const map = L.map(el.current, {
      zoomControl: false,
      attributionControl: false,
      // Continuous zoom: fractional levels allowed, and the stock steppy wheel
      // handler is swapped for the rAF-eased SmoothWheelZoom glide.
      zoomSnap: 0,
      zoomDelta: 0.4,
      scrollWheelZoom: false,
      smoothWheelZoom: true,
      smoothSensitivity: 1.2,
    }).setView(center, weather ? 9 : 4.5);
    mapRef.current = map;

    L.control.attribution({ position: 'bottomleft' }).addAttribution(BASEMAP_ATTRIBUTION).addTo(map);
    L.control.scale({ position: 'bottomleft', imperial: false, maxWidth: 90 }).addTo(map);

    // Anywhere on the basemap is a valid question: "what's the weather here?"
    map.on('click', (e) => detailRef.current?.({ name: null, lat: e.latlng.lat, lon: e.latlng.lng }));

    const track = () => {
      const c = map.getCenter();
      setViewport({ lat: c.lat, lon: c.lng, zoom: map.getZoom() });
    };
    map.on('moveend', track);
    track();

    // Any direct handling of the map counts as the person taking over the view.
    const touched = () => {
      userTouched.current = true;
    };
    ['mousedown', 'touchstart', 'wheel', 'keydown'].forEach((ev) =>
      el.current.addEventListener(ev, touched, { passive: true, once: true })
    );

    // Open on the device's location, Google-Maps style. Until (or unless) a fix
    // arrives, the view above stays: the weather page's place, else Indonesia.
    getDevicePosition({ maximumAge: 120000 })
      .then((here) => {
        if (!mapRef.current) return;
        setMyPos(here);
        if (!userTouched.current && !routeRef.current) {
          mapRef.current.flyTo([here.lat, here.lon], 13, { duration: 1 });
        }
      })
      .catch(() => {
        /* denied or unavailable: keep the fallback view */
      });

    return () => {
      map.remove();
      mapRef.current = null;
      routeLayer.current = null;
      pinMarker.current = null;
      meLayer.current = null;
      baseLayer.current = null;
      chipGroup.current = null;
      chipMarkers.current = new Map();
      radarLayers.current = new Map();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Coming back to a tab that was hidden: the container was 0×0 while display:none,
  // so Leaflet must re-measure or tiles render in the wrong place.
  useEffect(() => {
    if (visible) setTimeout(() => mapRef.current?.invalidateSize(), 50);
    else setPlaying(false);
  }, [visible]);


  /* ---------------- "you are here" ---------------- */
  useEffect(() => {
    const L = window.L;
    const map = mapRef.current;
    if (!ready || !L || !map || !myPos) return;
    meLayer.current?.remove();
    const group = L.layerGroup();
    // A loose fix (Wi-Fi/IP) gets an accuracy ring; a tight GPS fix doesn't need one.
    if (myPos.acc && myPos.acc > 40 && myPos.acc < 5000) {
      L.circle([myPos.lat, myPos.lon], {
        radius: myPos.acc,
        color: '#4c8dff',
        weight: 1,
        opacity: 0.35,
        fillColor: '#4c8dff',
        fillOpacity: 0.08,
        interactive: false,
      }).addTo(group);
    }
    const dot = L.marker([myPos.lat, myPos.lon], {
      icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
      keyboard: false,
      zIndexOffset: 500,
      title: 'Your location',
    });
    dot.on('click', () => detailRef.current?.({ name: 'Your location', lat: myPos.lat, lon: myPos.lon }));
    dot.addTo(group);
    group.addTo(map);
    meLayer.current = group;
  }, [ready, myPos]);

  /* ---------------- basemap ---------------- */
  // Street map (with names) or plain canvas. The street map is the same tiles in
  // both themes, recoloured by CSS, so a theme flip only rebuilds the canvas.
  // Either way the map itself is kept, so pan, zoom and any route survive.
  const basemapKey = layers.labels ? 'street' : `canvas-${theme === 'light' ? 'light' : 'dark'}`;
  useEffect(() => {
    const L = window.L;
    const map = mapRef.current;
    if (!ready || !L || !map) return;
    baseLayer.current?.remove();
    const street = basemapKey === 'street';
    baseLayer.current = L.tileLayer(street ? STREET : CANVAS[basemapKey.slice(7)], {
      maxZoom: 19,
      maxNativeZoom: street ? STREET_MAX_NATIVE_ZOOM : CANVAS_MAX_NATIVE_ZOOM,
      className: 'basemap-tiles',
      zIndex: 1,
    }).addTo(map);
  }, [ready, basemapKey]);

  /* ---------------- radar overlay + timeline ---------------- */
  // RainViewer keeps about two hours of frames, so a tab left open would end up
  // pointing at expired tiles. Refresh the index every ten minutes while shown.
  useEffect(() => {
    if (!layers.radar || !visible) return undefined;
    const id = setInterval(() => setRadarTick((t) => t + 1), 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [layers.radar, visible]);

  // Load (or refresh) the frame index whenever radar is switched on.
  useEffect(() => {
    if (!ready || !layers.radar) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const idx = await (await fetch(RAINVIEWER_INDEX)).json();
        const past = idx.radar?.past || [];
        const nowcast = idx.radar?.nowcast || [];
        if (cancelled || !past.length) return;
        radarHost.current = idx.host;
        const list = [
          ...past.map((f) => ({ time: f.time * 1000, path: f.path })),
          ...nowcast.map((f) => ({ time: f.time * 1000, path: f.path, forecast: true })),
        ];
        // Drop layers for frames that have aged out of the index.
        const keep = new Set(list.map((f) => f.path));
        radarLayers.current.forEach((layer, path) => {
          if (!keep.has(path)) {
            layer.remove();
            radarLayers.current.delete(path);
          }
        });
        setFrames(list);
        setLatestIdx(past.length - 1);
        setFrameIdx(past.length - 1);
      } catch {
        /* radar is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, layers.radar, radarTick]);

  // Show the selected frame. Each frame is its own tile layer kept on the map
  // at opacity 0 once loaded, so scrubbing and playback swap instantly instead
  // of waiting on tiles. The next frame is preloaded ahead of time.
  useEffect(() => {
    const L = window.L;
    const map = mapRef.current;
    if (!ready || !L || !map) return;

    if (!layers.radar) {
      radarLayers.current.forEach((layer) => layer.remove());
      radarLayers.current = new Map();
      setPlaying(false);
      return;
    }
    const frame = frames[frameIdx];
    if (!frame || !radarHost.current) return;

    const ensure = (f) => {
      if (!f) return null;
      let layer = radarLayers.current.get(f.path);
      if (!layer) {
        layer = L.tileLayer(`${radarHost.current}${f.path}/256/{z}/{x}/{y}/4/1_1.png`, {
          opacity: 0,
          zIndex: 400,
          maxNativeZoom: RADAR_MAX_NATIVE_ZOOM,
          maxZoom: 19,
        }).addTo(map);
        radarLayers.current.set(f.path, layer);
      }
      return layer;
    };

    const current = ensure(frame);
    ensure(frames[(frameIdx + 1) % frames.length]);
    radarLayers.current.forEach((layer) => layer.setOpacity(layer === current ? RADAR_OPACITY : 0));
  }, [ready, layers.radar, frames, frameIdx]);

  useEffect(() => {
    if (!playing || frames.length < 2) return undefined;
    const id = setInterval(() => setFrameIdx((i) => (i + 1) % frames.length), RADAR_STEP_MS);
    return () => clearInterval(id);
  }, [playing, frames.length]);

  const frame = frames[frameIdx];
  const frameLabel = (() => {
    if (!frame) return '';
    const latest = frames[latestIdx];
    const mins = latest ? Math.round((frame.time - latest.time) / 60000) : 0;
    if (mins === 0) return 'Now';
    return mins < 0 ? `${mins} min` : `+${mins} min`;
  })();

  /* ---------------- city temperature chips ---------------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !layers.temps || !viewport) {
      setChips([]);
      return undefined;
    }
    const bounds = map.getBounds().pad(0.05);
    const z = viewport.zoom;
    // Major cities claim space first; any chip that would overlap one already
    // placed on screen is skipped, so a zoomed-out metro area shows one reading
    // instead of a pile.
    // The "you are here" dot claims its spot first, so no chip sits on it.
    const placed = myPos ? [map.latLngToContainerPoint([myPos.lat, myPos.lon])] : [];
    const inView = CITIES.filter((c) => bounds.contains([c.lat, c.lon]) && (c.tier === 1 || z >= TIER2_ZOOM))
      .sort((a, b) => a.tier - b.tier)
      .filter((c) => {
        const pt = map.latLngToContainerPoint([c.lat, c.lon]);
        if (placed.some((p) => Math.abs(p.x - pt.x) < CHIP_W && Math.abs(p.y - pt.y) < CHIP_H)) return false;
        placed.push(pt);
        return true;
      })
      .slice(0, MAX_CHIPS);
    if (!inView.length) {
      setChips([]);
      return undefined;
    }
    const controller = new AbortController();
    fetchCityConditions(inView, controller.signal).then((list) => {
      if (!controller.signal.aborted) setChips(list);
    });
    return () => controller.abort();
  }, [ready, layers.temps, viewport, myPos]);

  // Keep one Leaflet marker per chip; React renders each chip's contents into
  // the marker's own element through a portal.
  useEffect(() => {
    const L = window.L;
    const map = mapRef.current;
    if (!ready || !L || !map) return;
    if (!chipGroup.current) chipGroup.current = L.layerGroup().addTo(map);

    const keep = new Set(chips.map((c) => c.name));
    chipMarkers.current.forEach((entry, key) => {
      if (!keep.has(key)) {
        entry.marker.remove();
        chipMarkers.current.delete(key);
      }
    });
    chips.forEach((c) => {
      if (chipMarkers.current.has(c.name)) return;
      const node = document.createElement('div');
      const marker = L.marker([c.lat, c.lon], {
        icon: L.divIcon({ html: node, className: 'city-chip-icon', iconSize: [0, 0] }),
        keyboard: false,
        riseOnHover: true,
      });
      marker.on('click', () => {
        mapRef.current?.flyTo([c.lat, c.lon], Math.max(mapRef.current.getZoom(), 9), { duration: 0.8 });
        detailRef.current?.({ name: c.name, label: `${c.name}, ${c.country}`, lat: c.lat, lon: c.lon });
      });
      marker.addTo(chipGroup.current);
      chipMarkers.current.set(c.name, { marker, el: node });
    });
    setChipEls([...chipMarkers.current.entries()].map(([key, entry]) => [key, entry.el]));
  }, [ready, chips]);

  /* ---------------- click-for-detail panel ---------------- */
  const openDetail = useCallback(async (place) => {
    setCands(null);
    setMenuField(null);
    setLayersOpen(false);
    setCopied(false);
    setShowHint(false);
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      /* ignore */
    }
    // Pin first, so the click is acknowledged before the forecast arrives.
    const L = window.L;
    const map = mapRef.current;
    if (L && map) {
      pinMarker.current?.remove();
      pinMarker.current = L.marker([place.lat, place.lon], {
        icon: L.divIcon({ className: '', html: '<div class="rc-pulse"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }),
        interactive: false,
      }).addTo(map);
    }
    setDetail({ loading: true, place, point: !place.name });
    setSheetExpanded(false);
    try {
      const data = await fetchWeatherByCoords(place.lat, place.lon);
      const wx = toDetail(data);
      setDetail((cur) =>
        cur && cur.place === place ? { ...cur, loading: false, place: { ...place, name: place.name || wx.name }, wx } : cur
      );
    } catch {
      setDetail((cur) => (cur && cur.place === place ? { ...cur, loading: false, wx: null } : cur));
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

  const remember = (place) => setRecents(addRecent(place));

  const selectPlace = (place) => {
    typeahead.cancel(); // a suggestion still in flight must not reopen the list post-selection
    setCands(null);
    setMenuField(null);
    setSearching(false);
    remember(place);
    mapRef.current?.flyTo([place.lat, place.lon], Math.max(mapRef.current.getZoom(), 11), { duration: 0.8 });
    openDetail(place);
  };

  // The origin and dest typeaheads are separate instances (a shared debounce/abort
  // would let typing in one cancel the other) but they share ONE `cands` list. So a
  // result is applied only if its field is still the one being edited — otherwise a
  // slow From result would replace the To suggestions and a click would fill the
  // wrong field. An empty result clears any open *suggestion* list (so a short To edit
  // can't leave From suggestions open under it, where a click would rewrite the field
  // not being edited), but never the post-submit 'dest' picker (a short From edit must
  // not close that one).
  const applySuggestions = (field, kind) => (list) => {
    if (activeField.current !== field) return;
    setSearching(false);
    setCands((prev) => (list.length ? { kind, list } : prev && prev.kind === 'dest' ? prev : null));
  };

  const startTyping = (field, value) => {
    activeField.current = field;
    setMenuField(field);
    const t = value.trim();
    setSearching(t.length >= 3 && !looksLikeUrl(t));
  };

  // Explore box as-you-type: Photon only, debounced, and always superseded by
  // whatever the user typed most recently — see createSuggestTypeahead.
  const handleQueryChange = (e) => {
    const value = e.target.value;
    setQ(value);
    startTyping('explore', value);
    typeahead.run(value, mapCenter(), applySuggestions('explore', 'explore'));
  };

  // Directions inputs get the same as-you-type treatment, each on its own
  // typeahead instance. Editing after a pick invalidates that pick immediately
  // (rather than waiting for submit) so a stale pin never lingers behind
  // text that no longer describes it.
  const handleOriginChange = (e) => {
    const value = e.target.value;
    setOriginText(value);
    if (!pickIsCurrent(originPick.current, value)) originPick.current = null;
    startTyping('origin', value);
    originTypeahead.run(value, mapCenter(), applySuggestions('origin', 'origin'));
  };

  const handleDestChange = (e) => {
    const value = e.target.value;
    setDestText(value);
    if (!pickIsCurrent(destPick.current, value)) destPick.current = null;
    startTyping('dest', value);
    destTypeahead.run(value, mapCenter(), applySuggestions('dest', 'dest-suggest'));
  };

  // Picking a suggestion fills the field and remembers the exact place chosen —
  // it must not run the route: the user may still be composing the trip (origin
  // not set yet), and navigating on a single click while typing would surprise
  // them. They confirm with the submit button, same as typing a full address.
  const pickOrigin = (place) => {
    originTypeahead.cancel(); // a suggestion still in flight must not reopen the list post-pick
    originPick.current = { text: place.name, place };
    setOriginText(place.name);
    setCands(null);
    setSearching(false);
    // Next step of composing a trip: the destination.
    setTimeout(() => destInput.current?.focus(), 0);
  };

  const pickDest = (place) => {
    destTypeahead.cancel();
    destPick.current = { text: place.name, place };
    setDestText(place.name);
    setCands(null);
    setSearching(false);
    setMenuField(null);
  };

  // A pasted Google Maps link is an exact spot — no geocoding, no guessing. It's
  // the escape hatch for everything the geocoders don't index: a new café, a
  // dropped pin, a friend's shared location.
  const resolveInput = async (text) => {
    const url = parseMapsUrl(text);
    if (!url) return null;
    const pin = await resolveMapsUrl(url);
    if (!pin) {
      setError(
        "I couldn't read a location out of that link. Open it in Google Maps, then copy the URL from the address bar — the one with coordinates in it."
      );
      return { failed: true };
    }
    return pin;
  };

  const handleExplore = async (e) => {
    e.preventDefault();
    const text = q.trim();
    if (!text || busy) return;
    typeahead.cancel(); // the explicit search chain now owns `cands`
    setSearching(false);
    setBusy(true);
    setError('');
    try {
      const pin = await resolveInput(text);
      if (pin?.failed) return; // resolveInput already explained what went wrong
      if (pin) return selectPlace(pin);

      const list = await geocodeCandidates(text, mapCenter(), SEARCH_RESULTS);
      if (!list.length) return setError(NOT_FOUND(text));
      if (list.length === 1) return selectPlace(list[0]);
      setCands({ kind: 'explore', list, submitted: true });
      setMenuField('explore');
    } finally {
      setBusy(false);
    }
  };

  /* ---------------- geolocation ---------------- */
  const withPosition = (onPos) => {
    setLocating(true);
    setError('');
    getDevicePosition()
      .then((here) => {
        setLocating(false);
        onPos(here);
      })
      .catch((err) => {
        setLocating(false);
        setError(err.message);
      });
  };

  const locate = () =>
    withPosition(({ lat, lon, acc }) => {
      setMyPos({ lat, lon, acc });
      mapRef.current?.flyTo([lat, lon], Math.max(mapRef.current.getZoom(), 14), { duration: 0.8 });
      openDetail({ name: 'Your location', lat, lon });
    });

  const setOriginToMyLocation = () =>
    withPosition(({ lat, lon, acc }) => {
      setMyPos({ lat, lon, acc });
      const place = { name: 'My location', label: 'My location', lat, lon };
      originTypeahead.cancel();
      originPick.current = { text: place.name, place };
      setOriginText(place.name);
      setCands(null);
      setTimeout(() => destInput.current?.focus(), 0);
    });

  /* ---------------- directions ---------------- */
  // Where a trip starts when the From field is left empty: the device's
  // location if we have it, else the place shown on the weather page.
  const defaultOrigin = () =>
    myPos
      ? { name: 'My location', label: 'My location', lat: myPos.lat, lon: myPos.lon }
      : weather && Number.isFinite(weather.lat)
      ? { name: weather.city, label: weather.city, lat: weather.lat, lon: weather.lon }
      : null;

  const runRoute = useCallback(async (originLoc, destLoc) => {
    setBusy(true);
    setError('');
    setCands(null);
    setMenuField(null);
    try {
      const result = await getRoutesWithRain(originLoc, destLoc, Date.now());
      setRoute({ origin: originLoc, dest: destLoc, routes: result.routes, bestIndex: result.bestIndex });
      setSelRoute(result.bestIndex);
      setRouteOpen(true);
      setRecents(addRecent(destLoc));
      if (window.matchMedia?.(NARROW_QUERY).matches || window.matchMedia?.(SHORT_QUERY).matches) setFormCollapsed(true);
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
    if (!destQ) {
      destInput.current?.focus();
      return;
    }
    originTypeahead.cancel(); // the explicit submit chain now owns `cands`
    destTypeahead.cancel();
    setSearching(false);
    setBusy(true);
    setError('');
    try {
      const originQ = originText.trim();
      // A suggestion picked for this exact text beats re-geocoding it — the
      // string alone can't tell "Central Park, Jakarta Selatan" apart from
      // every other Central Park, but the pick already did.
      const originFromPick = pickIsCurrent(originPick.current, originText) ? originPick.current.place : null;
      // Either endpoint can be a pasted link.
      const originPin = !originFromPick && originQ ? await resolveInput(originQ) : null;
      if (originPin?.failed) return;
      const originLoc =
        originFromPick ||
        originPin ||
        (originQ ? await geocode(originQ, mapCenter()) : defaultOrigin());
      if (!originLoc) {
        return setError(
          originQ ? NOT_FOUND(originQ) : 'Type a starting point, or pick “Your location”.'
        );
      }

      const destFromPick = pickIsCurrent(destPick.current, destText) ? destPick.current.place : null;
      if (destFromPick) return await runRoute(originLoc, destFromPick);

      const destPin = await resolveInput(destQ);
      if (destPin?.failed) return;
      if (destPin) return await runRoute(originLoc, destPin);

      const list = await geocodeCandidates(destQ, originLoc, SEARCH_RESULTS);
      if (!list.length) return setError(NOT_FOUND(destQ));
      if (list.length === 1) return await runRoute(originLoc, list[0]);
      setCands({ kind: 'dest', list, origin: originLoc });
      setMenuField('dest');
    } finally {
      setBusy(false);
    }
  };

  // Swap From and To, picks included. An empty From means the default origin
  // (device location, else the weather page's place), so swapping turns that
  // into an explicit destination.
  const swapEnds = () => {
    originTypeahead.cancel();
    destTypeahead.cancel();
    const implicit = !originText.trim() ? defaultOrigin() : null;
    const nextDestText = implicit ? implicit.name : originText;
    const nextDestPick = implicit ? { text: implicit.name, place: implicit } : originPick.current;
    originPick.current = destPick.current;
    destPick.current = nextDestPick;
    setOriginText(destText);
    setDestText(nextDestText);
    setCands(null);
    setMenuField(null);
  };

  const clearRoute = () => {
    setFormCollapsed(false);
    setRoute(null);
    routeLayer.current?.remove();
    routeLayer.current = null;
    onRouteShown?.();
  };

  // Route pushed in from the chatbot.
  useEffect(() => {
    if (!initialRoute) return;
    setMode('directions');
    // These setStates bypass handleOriginChange/handleDestChange, so drop the picks
    // here: a leftover pick whose text happens to equal the pushed name would be
    // trusted on submit and route to the stale pin.
    originPick.current = null;
    destPick.current = null;
    setOriginText(initialRoute.origin?.name || '');
    setDestText(initialRoute.dest?.name || '');
    setRoute(initialRoute);
    setSelRoute(initialRoute.bestIndex ?? 0);
    setRouteOpen(true);
    if (window.matchMedia?.(NARROW_QUERY).matches || window.matchMedia?.(SHORT_QUERY).matches) setFormCollapsed(true);
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
      const alt = L.polyline(r.coordinates, { color: ALT_ROUTE_COLOR, weight: 5, opacity: 0.4, lineJoin: 'round' });
      alt.on('click', () => setSelRoute(i));
      alt.on('mouseover', () => alt.setStyle({ opacity: 0.75 }));
      alt.on('mouseout', () => alt.setStyle({ opacity: 0.4 }));
      alt.bindTooltip(`${Math.round(r.durationMin)} min · ${r.distanceKm.toFixed(1)} km`, { sticky: true, direction: 'top' });
      alt.addTo(group);
    });

    const sel = route.routes[selRoute];
    segmentsOf(sel).forEach((s) => {
      const line = L.polyline(sel.coordinates.slice(s.from, s.to + 1), {
        // Green at 0% chance of rain through to red at 100%.
        color: segmentStroke(s, theme),
        ...((LEVEL[s.level] || LEVEL.unknown).dashed ? { dashArray: '7 9' } : {}),
        weight: 6,
        opacity: 0.95,
        lineJoin: 'round',
        lineCap: 'round',
      }).addTo(group);
      if (s.at) {
        const when = fmtClock(s.at);
        const chance = typeof s.chance === 'number' ? ` · ${s.chance}% rain` : '';
        line.bindTooltip(`~${when}${chance}`, { sticky: true, direction: 'top' });
      }
    });

    // Mark each point where the chance of rain changes along the selected route.
    rainBreakpoints(sel).forEach((m) => {
      const when = m.at ? ` around ${fmtClock(m.at)}` : '';
      const text = m.start
        ? `Starting at ${m.chance}% chance of rain${when}`
        : `From here${when}: ${m.prev}% → ${m.chance}% chance of rain`;
      L.marker([m.lat, m.lon], {
        icon: L.divIcon({ className: '', html: breakpointHtml(m, theme), iconSize: [0, 0] }),
        keyboard: false,
        zIndexOffset: 200,
      })
        .bindTooltip(text, { direction: 'top', offset: [0, -10] })
        .addTo(group);
    });

    const dot = (color) =>
      L.divIcon({
        className: '',
        html: `<div style="width:14px;height:14px;border-radius:9999px;background:${color};border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35)"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
    L.marker([route.origin.lat, route.origin.lon], { icon: dot('#38bdf8') })
      .bindTooltip(`From · ${route.origin.name}`, { direction: 'top', offset: [0, -8] })
      .addTo(group);
    L.marker([route.dest.lat, route.dest.lon], { icon: dot('#fb923c') })
      .bindTooltip(`To · ${route.dest.name}`, { direction: 'top', offset: [0, -8] })
      .addTo(group);

    if (lastFitted.current !== route) {
      lastFitted.current = route;
      // Keep the route clear of the floating UI. Phones: the folded row sits on
      // top and the route sheet at the bottom. Elsewhere, measure the panel and
      // put the route beside it or under it, whichever leaves more room.
      const size = map.getSize();
      const phone = window.matchMedia?.(NARROW_QUERY).matches;
      let topLeft = [32, 120];
      let bottomRight = [64, 400];
      if (!phone) {
        const bottomPad = size.y < 420 ? 20 : 80; // radar timeline
        topLeft = [24, 24];
        bottomRight = [64, bottomPad]; // map buttons on the right
        const panel = panelRef.current;
        if (panel?.offsetParent) {
          const box = el.current.getBoundingClientRect();
          const pb = panel.getBoundingClientRect();
          const right = pb.right - box.left + 16;
          const below = pb.bottom - box.top + 16;
          const beside = Math.max(0, size.x - right - 64) * Math.max(0, size.y - 24 - bottomPad);
          const under = Math.max(0, size.x - 88) * Math.max(0, size.y - below - bottomPad);
          topLeft = beside >= under ? [right, 24] : [24, below];
        }
      }
      // Never let the padding swallow the map (that would zoom to the max).
      if (size.x - topLeft[0] - bottomRight[0] < 80 || size.y - topLeft[1] - bottomRight[1] < 80) {
        topLeft = [24, 24];
        bottomRight = [24, 24];
      }
      map.fitBounds(L.latLngBounds(route.routes[route.bestIndex].coordinates), {
        paddingTopLeft: topLeft,
        paddingBottomRight: bottomRight,
      });
    }
  }, [ready, route, selRoute, theme]); // theme: stroke ramp is per-basemap, so a flip must redraw

  /* ---------------- suggestion menu ---------------- */
  const fieldText = { explore: q, origin: originText, dest: destText };

  const menuGroups = (() => {
    if (!menuField) return [];
    const text = fieldText[menuField] || '';
    const remote = cands && kindField(cands.kind) === menuField ? cands : null;
    // Post-submit pickers show the geocoder's answer alone: the user asked a
    // specific question, and recommendations would dilute it.
    if (remote && remote.kind === 'dest') return mergeRemote([], remote.list, 'Which one did you mean?');
    if (remote && remote.submitted) return mergeRemote([], remote.list, `Results for “${text.trim()}”`);
    if (looksLikeUrl(text)) return [];
    const local = buildLocalGroups({
      query: text,
      recents,
      cities: CITIES,
      near: viewport,
      locate: menuField !== 'dest',
    });
    return text.trim().length >= 3 && remote ? mergeRemote(local, remote.list, 'Places') : local;
  })();
  const menuItems = flatItems(menuGroups);

  const pickItem = (item) => {
    const field = menuField;
    const remote = cands && kindField(cands.kind) === field ? cands : null;
    setMenuField(null);
    if (item.type === 'locate') {
      if (field === 'origin') return setOriginToMyLocation();
      return locate();
    }
    const place = item.place;
    if (field === 'explore') return selectPlace(place);
    if (field === 'origin') return pickOrigin(place);
    if (remote?.kind === 'dest' && item.type === 'place') return runRoute(remote.origin, place);
    return pickDest(place);
  };

  const nav = useMenuNav(menuItems, pickItem);

  const fieldProps = (field) => ({
    onFocus: () => {
      activeField.current = field;
      setMenuField(field);
      setLayersOpen(false);
    },
    onKeyDown: (e) => {
      if (e.key === 'Escape') {
        if (menuField) setMenuField(null);
        else e.currentTarget.blur();
        return;
      }
      if (menuField !== field) setMenuField(field);
      nav.onKeyDown(e);
    },
    role: 'combobox',
    'aria-expanded': menuField === field && menuItems.length > 0,
    'aria-controls': 'map-search-menu',
    'aria-autocomplete': 'list',
    autoComplete: 'off',
  });

  // Close menus and the layers popover on any press outside the panels.
  useEffect(() => {
    if (!menuField) return undefined;
    const onDown = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setMenuField(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [menuField]);

  // "/" jumps to search; Escape closes whatever is on top.
  useEffect(() => {
    if (!visible) return undefined;
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;
      if (e.key === '/' && !typing) {
        e.preventDefault();
        (mode === 'explore' ? exploreInput : destInput).current?.focus();
      } else if (e.key === 'Escape' && !typing) {
        if (layersOpen) setLayersOpen(false);
        else if (detail) closeDetail();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const switchMode = (id) => {
    setFormCollapsed(false);
    typeahead.cancel();
    originTypeahead.cancel();
    destTypeahead.cancel();
    setMode(id);
    setCands(null);
    setMenuField(null);
    setSearching(false);
    setError('');
    setTimeout(() => (id === 'explore' ? exploreInput : originText ? destInput : originInput).current?.focus(), 0);
  };

  const zoomBy = (d) => {
    const map = mapRef.current;
    if (map) map.setZoom(map.getZoom() + d, { animate: true });
  };

  const routeToDetail = () => {
    const dest = { name: detail.place.name, lat: detail.place.lat, lon: detail.place.lon };
    const fromPick = pickIsCurrent(originPick.current, originText) ? originPick.current.place : null;
    const origin = fromPick || defaultOrigin();
    setMode('directions');
    destPick.current = { text: dest.name || '', place: dest };
    setDestText(dest.name || '');
    if (origin) runRoute(origin, dest);
    else {
      setError('Pick a starting point to route here.');
      setTimeout(() => originInput.current?.focus(), 0);
    }
  };

  const startFromDetail = () => {
    const place = { name: detail.place.name, label: detail.wx?.region, lat: detail.place.lat, lon: detail.place.lon };
    setMode('directions');
    originPick.current = { text: place.name, place };
    setOriginText(place.name);
    closeDetail();
    setTimeout(() => destInput.current?.focus(), 0);
  };

  const copyCoords = async () => {
    const text = `${detail.place.lat.toFixed(5)}, ${detail.place.lon.toFixed(5)}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — nothing to do */
    }
  };

  const shown = route?.routes[selRoute];
  const legend = shown ? [...new Set(segmentsOf(shown).map((s) => s.level))] : [];
  // With the label layer on, the basemap already names every town; repeating it
  // in the chip would print each name twice.
  const showNames = !layers.labels && (viewport?.zoom ?? 0) >= NAME_ZOOM;
  const chipByName = new Map(chips.map((c) => [c.name, c]));

  // Phones, once a route is drawn: the search panel steps aside and the route
  // sheet at the bottom carries the trip (tap its header to edit).
  // Landscape phones get the same fold, with the route card under the panel.
  const compact = narrow || short;
  const routeFolded = compact && !!route && formCollapsed;
  // Phones: an expanded weather sheet takes the screen; the panels behind it step aside.
  const sheetCovers = narrow && !!detail && sheetExpanded;
  const editRoute = () => {
    setFormCollapsed(false);
    setTimeout(() => destInput.current?.focus(), 0);
  };

  // Route options, rendered under the search panel on desktop and as a bottom
  // sheet on phones (see the two placements in the JSX).
  const routePanel = route && (
          <div className={`panel-float overflow-hidden rounded-[22px] ${narrow || routeFolded ? '' : 'mt-2'}`}>
            <div className="flex items-center gap-1 py-2 pl-2 pr-2 text-xs text-ink/70 sm:gap-2 sm:py-3 sm:pl-4">
              {compact ? (
                <button
                  type="button"
                  onClick={editRoute}
                  aria-label="Edit route"
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl px-2 py-1.5 text-left transition active:bg-ink/[0.06]"
                >
                  {/* Two lines so a long destination keeps its name on a narrow phone. */}
                  <span className="min-w-0 flex-1 space-y-0.5">
                    <span className="flex items-center gap-1.5 text-[11px] text-ink/50">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-300" />
                      <span className="truncate">From {route.origin.name}</span>
                    </span>
                    <span className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-orange-300" />
                      <span className="truncate">{route.dest.name}</span>
                    </span>
                  </span>
                  <Pencil size={12} className="shrink-0 text-ink/45" />
                </button>
              ) : (
                <>
                  <span className="h-2 w-2 shrink-0 rounded-full bg-sky-300" />
                  <span className="truncate">{route.origin.name}</span>
                  <span className="text-ink/30">to</span>
                  <span className="h-2 w-2 shrink-0 rounded-full bg-orange-300" />
                  <span className="truncate font-medium text-ink">{route.dest.name}</span>
                </>
              )}
              <button
                onClick={() => setRouteOpen((o) => !o)}
                aria-label={routeOpen ? 'Collapse route options' : 'Expand route options'}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink/50 hover:bg-ink/10 hover:text-ink sm:ml-auto"
              >
                <ChevronDown size={14} className={`transition-transform ${routeOpen ? '' : '-rotate-90'}`} />
              </button>
              <button
                onClick={clearRoute}
                aria-label="Clear route"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink/50 hover:bg-ink/10 hover:text-ink"
              >
                <X size={14} />
              </button>
            </div>
            {routeOpen && (
              <div className="space-y-1 px-2 pb-2">
                {route.routes.map((r, i) => {
                  const lv = LEVEL[r.rain.level] || LEVEL.dry;
                  const isSel = i === selRoute;
                  return (
                    <button
                      key={i}
                      onClick={() => setSelRoute(i)}
                      aria-pressed={isSel}
                      className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition ${
                        isSel ? 'bg-ink/[0.08] ring-1 ring-ink/10' : 'hover:bg-ink/[0.04]'
                      }`}
                    >
                      {/* Rule: anything that samples the drawn map line (this dot, the legend swatches) uses
                          `strokeOf(level, theme)` on a miniature of the basemap (CHIP_BG[theme]); anything
                          that is panel TEXT (the badge) uses `ink`. */}
                      <span className="inline-flex shrink-0 items-center rounded-full p-1 ring-1 ring-ink/15" style={{ background: CHIP_BG[theme] || CHIP_BG.dark }}>
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: isSel ? segmentStroke({ level: r.rain.level, chance: r.rain.chance }, theme) : ALT_ROUTE_COLOR }}
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="eyebrow block !text-[10px] text-ink/40">
                          {i === route.bestIndex ? 'Recommended' : `Alternative ${i < route.bestIndex ? i + 1 : i}`}
                        </span>
                        <span className="flex items-baseline gap-2">
                          <span className={`display tabular text-lg ${isSel ? 'text-ink' : 'text-ink/70'}`}>
                            {Math.round(r.durationMin)} min
                          </span>
                          <span className="tabular text-xs text-ink/45">{r.distanceKm.toFixed(1)} km</span>
                        </span>
                      </span>
                      <span
                        className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                        style={{ background: `${lv.ink}22`, color: lv.ink }}
                      >
                        {lv.label}
                        {typeof r.rain.chance === 'number' && r.rain.level !== 'unknown' && ` · ${r.rain.chance}%`}
                      </span>
                    </button>
                  );
                })}
                <div className="space-y-1.5 px-2 pb-1 pt-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-ink/45">
                    {/* Legend = a sample of the MAP line, drawn on a chip coloured like the basemap so
                        the ramp sits on the ground it was tuned against. */}
                    <span className="flex items-center gap-1.5">
                      <span>0%</span>
                      <span className="inline-flex items-center rounded-full px-1 py-0.5 ring-1 ring-ink/15" style={{ background: CHIP_BG[theme] || CHIP_BG.dark }}>
                        <span className="inline-block h-1.5 w-16 rounded-full" style={{ background: rainGradient(theme) }} />
                      </span>
                      <span>100% chance of rain</span>
                    </span>
                    {legend.includes('unknown') && <span>Dashed: no forecast</span>}
                  </div>
                  {shown?.arriveAt && (
                    <p className="text-[10px] text-ink/40">
                      Leaving now, arriving ~{fmtClock(shown.arriveAt)}. {narrow ? 'Tap' : 'Hover'} the road for rain at each stretch.
                      Times exclude live traffic.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        
  );

  const menu = menuField && (menuItems.length > 0 || searching) && (
    <div className="border-t border-ink/[0.08] p-1.5">
      <SuggestionMenu
        id="map-search-menu"
        groups={menuGroups}
        query={fieldText[menuField]}
        activeKey={nav.activeKey}
        onHover={nav.setActiveKey}
        onPick={pickItem}
        onRemove={(item) => setRecents(removeRecent(item.place))}
        loading={searching}
        className={
          // Phones: stop above the tab bar, whatever the form above it needs.
          !narrow
            ? 'max-h-[min(22rem,50vh)]'
            : mode === 'directions'
            ? 'max-h-[calc(100dvh-var(--map-top)-var(--map-bottom)-14.5rem)]'
            : 'max-h-[calc(100dvh-var(--map-top)-var(--map-bottom)-8rem)]'
        }
      />
    </div>
  );

  const inputRow = 'flex items-center gap-2.5 rounded-2xl bg-ink/[0.05] px-3.5 transition focus-within:bg-ink/[0.08] focus-within:ring-1 focus-within:ring-ink/15';
  const inputCls = 'w-full min-w-0 bg-transparent py-2.5 text-base text-ink placeholder-ink/40 outline-none sm:text-sm';

  return (
    <div
      data-basemap={layers.labels ? 'street' : 'canvas'}
      className="map-shell fixed inset-0 overflow-hidden sm:relative sm:inset-auto sm:h-[calc(100dvh-6.5rem)] sm:min-h-[220px] sm:rounded-[28px] sm:border sm:border-hairline md:h-[calc(100dvh-7.5rem)]"
    >
      <div ref={el} className="absolute inset-0 z-0" />

      {/* City chips live inside Leaflet markers, rendered by React. */}
      {chipEls.map(([key, node]) => {
        const city = chipByName.get(key);
        return city ? createPortal(<CityChip city={city} showName={showNames} />, node, key) : null;
      })}

      {!ready && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <Loader2 size={28} className="animate-spin text-ink/60" />
        </div>
      )}

      {/* ---------- search / directions panel ---------- */}
      <div
        ref={panelRef}
        className={`absolute left-3 top-[var(--map-top)] z-30 w-[calc(100%-4.5rem)] sm:top-3 sm:w-[min(380px,calc(100%-1.5rem))] ${
          (narrow && routeFolded) || sheetCovers ? 'hidden' : narrow && detail ? '[@media(max-height:720px)]:hidden' : ''
        } ${short ? 'thin-scroll max-h-[calc(100%-1.5rem)] overflow-y-auto rounded-[22px]' : ''}`}
      >
        <div className={`panel-float overflow-hidden rounded-[22px] ${routeFolded ? 'hidden' : ''}`}>
          {/* mode switch */}
          <div className="p-2 pb-0">
            <div className="flex rounded-full bg-ink/[0.05] p-1">
              {[
                { id: 'explore', label: 'Explore', icon: Search },
                { id: 'directions', label: 'Directions', icon: Navigation },
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => switchMode(id)}
                  aria-pressed={mode === id}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-semibold transition sm:text-xs ${
                    mode === id ? 'bg-panel text-ink shadow-sm ring-1 ring-ink/10' : 'text-ink/50 hover:text-ink'
                  }`}
                >
                  <Icon size={13} /> {label}
                </button>
              ))}
            </div>
          </div>

          {mode === 'explore' ? (
            <form onSubmit={handleExplore} className="p-2">
              <div className={inputRow}>
                {busy ? (
                  <Loader2 size={15} className="shrink-0 animate-spin text-ink/50" />
                ) : (
                  <Search size={15} className="shrink-0 text-ink/45" />
                )}
                <input
                  ref={exploreInput}
                  value={q}
                  onChange={handleQueryChange}
                  placeholder={narrow ? 'Search places' : 'Search places or paste a Maps link'}
                  aria-label="Search places"
                  className={inputCls}
                  {...fieldProps('explore')}
                />
                {q ? (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => {
                      setQ('');
                      setCands(null);
                      typeahead.cancel();
                      setSearching(false);
                      exploreInput.current?.focus();
                    }}
                    className="-mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink/45 hover:bg-ink/10 hover:text-ink"
                  >
                    <X size={14} />
                  </button>
                ) : (
                  <kbd className="hidden shrink-0 rounded-md border border-ink/15 px-1.5 text-[10px] font-medium text-ink/40 sm:block">
                    /
                  </kbd>
                )}
              </div>
            </form>
          ) : (
            <form onSubmit={handleDirections} className="p-2">
              <div className="relative space-y-1.5 pr-10">
                <div className={inputRow}>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-sky-300" />
                  <input
                    ref={originInput}
                    value={originText}
                    onChange={handleOriginChange}
                    placeholder={myPos ? 'From your location' : weather ? `From ${weather.city}` : 'Choose a starting point'}
                    aria-label="Starting point"
                    className={inputCls}
                    {...fieldProps('origin')}
                  />
                  {locating && <Loader2 size={13} className="shrink-0 animate-spin text-ink/50" />}
                </div>
                <div className={inputRow}>
                  <Flag size={12} className="shrink-0 text-orange-300" />
                  <input
                    ref={destInput}
                    value={destText}
                    onChange={handleDestChange}
                    placeholder="Where to? (or a Maps link)"
                    aria-label="Destination"
                    className={inputCls}
                    {...fieldProps('dest')}
                  />
                </div>
                <button
                  type="button"
                  onClick={swapEnds}
                  aria-label="Swap start and destination"
                  title="Swap"
                  className="absolute right-0 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-ink/55 transition hover:bg-ink/[0.08] hover:text-ink"
                >
                  <ArrowUpDown size={15} />
                </button>
              </div>
              <button type="submit" disabled={busy} className="btn-pill mt-2 h-11 w-full justify-center text-sm disabled:opacity-60 sm:h-10">
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Navigation size={14} />}
                {busy ? 'Checking the roads…' : 'Get route with rain check'}
              </button>
              {compact && route && !busy && (
                <button
                  type="button"
                  onClick={() => setFormCollapsed(true)}
                  className="mt-1 flex h-9 w-full items-center justify-center text-xs font-medium text-ink/55 transition hover:text-ink"
                >
                  Back to route
                </button>
              )}
            </form>
          )}

          {error && <p className="px-4 pb-3 text-xs leading-relaxed text-amber-300/90">{error}</p>}

          {menu}
        </div>

        {/* Desktop: route options sit under the search panel. */}
        {!narrow && routePanel}
      </div>

      {/* Phones: route options as a bottom sheet, clear of the search panel. */}
      {narrow && routeFolded && !detail && (
        <div className="absolute inset-x-3 bottom-[var(--map-bottom)] z-30 max-h-[48dvh] overflow-y-auto rounded-[22px] thin-scroll animate-fade-in-up">
          {routePanel}
        </div>
      )}

      {/* ---------- map controls ---------- */}
      <div className={`absolute right-3 top-[var(--map-top)] z-[35] flex-col items-end gap-2 sm:top-3 ${sheetCovers ? 'hidden' : 'flex'}`}>
        <div className="panel-float hidden flex-col overflow-hidden rounded-2xl sm:flex">
          <button onClick={() => zoomBy(1)} aria-label="Zoom in" title="Zoom in" className="map-btn">
            <Plus size={17} />
          </button>
          <span className="mx-2 h-px bg-ink/10" />
          <button onClick={() => zoomBy(-1)} aria-label="Zoom out" title="Zoom out" className="map-btn">
            <Minus size={17} />
          </button>
        </div>
        <div className="relative">
          <div className="panel-float flex flex-col overflow-hidden rounded-2xl">
            <button onClick={locate} aria-label="Go to my location" title="My location" className="map-btn">
              {locating ? <Loader2 size={17} className="animate-spin" /> : <LocateFixed size={17} />}
            </button>
            <span className="mx-2 h-px bg-ink/10" />
            <button
              onClick={() => {
                setLayersOpen((o) => !o);
                setMenuField(null);
              }}
              aria-label="Map layers"
              aria-pressed={layersOpen}
              title="Layers"
              className="map-btn"
            >
              <Layers size={17} />
            </button>
          </div>

          {layersOpen && (
            <div className="panel-float absolute right-12 top-0 z-40 w-[min(16rem,calc(100vw-6rem))] rounded-2xl p-1.5 animate-fade-in">
              <div className="eyebrow px-2.5 pb-1 pt-2 !text-[10px] text-ink/40">Map layers</div>
              {[
                { id: 'radar', icon: CloudRain, label: 'Rain radar', note: 'Last two hours, animated' },
                { id: 'temps', icon: Thermometer, label: 'Temperatures', note: 'Live readings for cities' },
                { id: 'labels', icon: Tag, label: 'Place names', note: 'Street map with towns and roads' },
              ].map(({ id, icon: Icon, label, note }) => (
                <button
                  key={id}
                  role="switch"
                  aria-checked={!!layers[id]}
                  onClick={() => setLayer(id, !layers[id])}
                  className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-ink/[0.05]"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink/[0.06] text-ink/60">
                    <Icon size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-ink">{label}</span>
                    <span className="block text-[11px] text-ink/45">{note}</span>
                  </span>
                  <Toggle on={!!layers[id]} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ---------- weather detail panel ---------- */}
      {detail && (
        <div className="absolute inset-x-3 bottom-[var(--map-bottom)] z-[38] animate-fade-in-up sm:bottom-auto sm:left-auto sm:right-16 sm:top-3 sm:w-[21rem]">
          <div
            className="panel-float max-h-[calc(100dvh-var(--map-top)-var(--map-bottom)-1rem)] overflow-y-auto rounded-[22px] px-5 pb-4 pt-2 thin-scroll sm:max-h-[calc(100dvh-10rem)] sm:pb-5 sm:pt-5"
            onTouchStart={(e) => {
              sheetTouch.current = e.touches[0].clientY;
            }}
            onTouchEnd={(e) => {
              if (!narrow || sheetTouch.current == null) return;
              const dy = e.changedTouches[0].clientY - sheetTouch.current;
              sheetTouch.current = null;
              // Only treat it as a sheet gesture when the sheet isn't scrolled.
              if (e.currentTarget.scrollTop > 0) return;
              if (dy < -40) setSheetExpanded(true);
              else if (dy > 60) {
                if (sheetExpanded) setSheetExpanded(false);
                else closeDetail();
              }
            }}
          >
            {/* Phone grab handle: tap to expand or shrink, or swipe the sheet. */}
            <button
              type="button"
              onClick={() => setSheetExpanded((v) => !v)}
              aria-label={sheetExpanded ? 'Show less' : 'Show more'}
              className="mx-auto mb-1 flex h-8 w-24 items-center justify-center sm:hidden"
            >
              <span className="h-1 w-10 rounded-full bg-ink/25" />
            </button>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="eyebrow !text-[10px] text-lilac">{detail.point ? 'Near this point' : 'Place'}</p>
                <h3 className="mt-1 truncate text-lg font-semibold tracking-tight text-ink">
                  {detail.place.name || detail.wx?.name || 'Loading…'}
                </h3>
                <p className="truncate text-xs text-ink/45">{detail.wx?.region || detail.place.label || ' '}</p>
              </div>
              <button
                onClick={closeDetail}
                aria-label="Close"
                className="-mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink/50 transition hover:bg-ink/10 hover:text-ink"
              >
                <X size={18} />
              </button>
            </div>

            {detail.loading ? (
              <div className="mt-5 space-y-3">
                <div className="h-12 w-32 animate-pulse rounded-xl bg-ink/[0.07]" />
                <div className="h-14 animate-pulse rounded-xl bg-ink/[0.05]" />
              </div>
            ) : !detail.wx ? (
              <p className="mt-4 text-sm text-ink/60">Couldn't load weather for this spot. Try another point.</p>
            ) : (
              <>
                <div className="mt-3 flex items-end gap-4 sm:mt-5">
                  <div className="display tabular text-5xl text-ink sm:text-6xl">{detail.wx.temp}°</div>
                  <div className="pb-1.5">
                    <div className="flex items-center gap-1.5 text-sm text-ink/80">
                      {getWeatherIcon(detail.wx.cond, 18, detail.wx.isDay)}
                      <span className="accent-serif text-lg">{detail.wx.cond.trim().toLowerCase()}</span>
                    </div>
                    <div className="text-xs text-ink/45">
                      Feels {detail.wx.feels}°
                      {detail.wx.high != null && ` · H ${detail.wx.high}° L ${detail.wx.low}°`}
                    </div>
                  </div>
                </div>

                <div className={`mt-5 grid grid-cols-3 divide-x divide-ink/10 border-y border-ink/10 py-3 text-center ${narrow && !sheetExpanded ? 'hidden' : ''}`}>
                  {[
                    { icon: Umbrella, value: `${detail.wx.rainChance}%`, label: 'Rain' },
                    { icon: Wind, value: `${detail.wx.wind}`, label: 'km/h' },
                    { icon: Droplets, value: `${detail.wx.humidity}%`, label: 'Humidity' },
                  ].map(({ icon: Icon, value, label }) => (
                    <div key={label}>
                      <div className="tabular text-base font-semibold text-ink">{value}</div>
                      <div className="mt-0.5 flex items-center justify-center gap-1 text-[10px] text-ink/45">
                        <Icon size={10} />
                        {label}
                      </div>
                    </div>
                  ))}
                </div>

                {detail.wx.hours.length > 0 && (
                  <div className={`no-scrollbar -mx-1 mt-3 flex gap-1 overflow-x-auto px-1 ${narrow && !sheetExpanded ? 'hidden' : ''}`}>
                    {detail.wx.hours.map((h, i) => (
                      <div key={h.time} className="flex min-w-[3.25rem] flex-col items-center gap-1 rounded-xl py-2">
                        <span className={`text-[10px] ${i === 0 ? 'font-semibold text-ink' : 'text-ink/45'}`}>
                          {i === 0 ? 'Now' : h.time}
                        </span>
                        {getWeatherIcon(h.cond, 16, h.isDay)}
                        <span className="tabular text-xs font-semibold text-ink">{h.temp}°</span>
                        <span className="tabular text-[10px] text-lilac">{h.rain}%</span>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  onClick={routeToDetail}
                  className="btn-pill mt-4 h-11 w-full justify-center text-sm sm:h-10"
                >
                  <Navigation size={14} /> Directions with rain check
                </button>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    onClick={startFromDetail}
                    className="flex h-10 items-center justify-center gap-1.5 rounded-full border border-ink/15 text-xs font-medium text-ink/75 transition hover:bg-ink/[0.06] hover:text-ink sm:h-9"
                  >
                    <MapPin size={13} /> Start from here
                  </button>
                  <button
                    onClick={() => onOpenWeather?.({ name: detail.place.name, lat: detail.place.lat, lon: detail.place.lon })}
                    className="flex h-10 items-center justify-center gap-1.5 rounded-full border border-ink/15 text-xs font-medium text-ink/75 transition hover:bg-ink/[0.06] hover:text-ink sm:h-9"
                  >
                    Full forecast <ArrowUpRight size={13} />
                  </button>
                </div>
              </>
            )}

            <button
              type="button"
              onClick={copyCoords}
              className={`mt-2 flex h-9 w-full items-center justify-center gap-1.5 text-[11px] text-ink/40 transition hover:text-ink/70 ${
                narrow && !sheetExpanded ? 'hidden' : ''
              }`}
              title="Copy coordinates"
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              <span className="tabular">
                {detail.place.lat.toFixed(4)}, {detail.place.lon.toFixed(4)}
              </span>
              {copied && <span>copied</span>}
            </button>
          </div>
        </div>
      )}

      {/* ---------- first-use hint + radar timeline ---------- */}
      <div
        className={`pointer-events-none absolute bottom-[var(--map-bottom)] left-3 right-3 z-20 flex flex-col items-center gap-2 sm:bottom-4 sm:left-1/2 sm:right-auto sm:w-[min(460px,calc(100%-14rem))] sm:-translate-x-1/2 ${
          detail && short ? 'hidden' : detail || (narrow && (route || menuField)) ? 'hidden sm:flex' : ''
        }`}
      >
        {showHint && !(short && route) && (
          <div className="panel-float pointer-events-auto flex items-center gap-2 rounded-full py-1.5 pl-3 pr-1.5 text-xs text-ink/70 animate-fade-in">
            <MousePointerClick size={13} className="text-butter" />
            Tap anywhere for local weather
            <button
              onClick={() => {
                setShowHint(false);
                try {
                  localStorage.setItem(HINT_KEY, '1');
                } catch {
                  /* ignore */
                }
              }}
              aria-label="Dismiss hint"
              className="-my-1 flex h-8 w-8 items-center justify-center rounded-full text-ink/45 hover:bg-ink/10 hover:text-ink"
            >
              <X size={11} />
            </button>
          </div>
        )}

        {layers.radar && frames.length > 1 && (
          <div className="panel-float pointer-events-auto flex w-full items-center gap-3 rounded-full py-1.5 pl-1.5 pr-4">
            <button
              onClick={() => {
                if (!playing && frameIdx === frames.length - 1) setFrameIdx(0);
                setPlaying((p) => !p);
              }}
              aria-label={playing ? 'Pause radar' : 'Play radar'}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accentFg transition active:scale-95"
            >
              {playing ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" className="translate-x-px" />}
            </button>
            <div className="min-w-0 flex-1">
              <input
                type="range"
                min={0}
                max={frames.length - 1}
                step={1}
                value={frameIdx}
                onChange={(e) => {
                  setPlaying(false);
                  setFrameIdx(Number(e.target.value));
                }}
                aria-label="Radar time"
                aria-valuetext={frame ? `${fmtClock(frame.time)}, ${frameLabel}` : undefined}
                className="radar-range block"
              />
            </div>
            <div className="shrink-0 text-right leading-tight">
              <div className={`tabular text-xs font-semibold ${frame?.forecast ? 'text-butter' : 'text-ink'}`}>
                {frame ? fmtClock(frame.time) : ''}
              </div>
              <div className="text-[10px] text-ink/45">{frame?.forecast ? `Forecast ${frameLabel}` : `Radar · ${frameLabel}`}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MapPage;
