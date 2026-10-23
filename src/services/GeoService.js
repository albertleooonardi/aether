// Place lookup for the chat. Returns a ranked *list* of candidates so the caller
// can ask the user which one they meant instead of silently betting on the top
// hit — "Grand Indonesia" legitimately matches a mall, a sky bridge and an
// estate agent's office 27km away.
//
// Providers, in order: backend proxy → Photon → Nominatim → WeatherAPI search.
// Both OSM geocoders read the same data, but Photon indexes POIs far better,
// while Nominatim is the more reliable fallback for plain place names.
import { WEATHER_API_KEY, WEATHER_BASE_URL, upstreamSignal } from './config';
import { rankPlaces, needsMore, nominatimLabel } from '../utils/placeRank';

const PHOTON = 'https://photon.komoot.io/api';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

const MAX_CANDIDATES = 4;

const shortName = (displayName) => displayName.split(',').slice(0, 2).join(',').trim();

// A preference, not a bound (no `bounded=1`) — distant cities must still resolve.
const VIEW_DEG = 3;

const biased = (near) => near && Number.isFinite(near.lat) && Number.isFinite(near.lon);

const viewboxOf = (near) =>
  biased(near)
    ? `&viewbox=${near.lon - VIEW_DEG},${near.lat - VIEW_DEG},${near.lon + VIEW_DEG},${near.lat + VIEW_DEG}`
    : '';

export const distanceKm = (a, b) => {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(a.lat * rad) * Math.cos(b.lat * rad);
  return 2 * R * Math.asin(Math.sqrt(h));
};

// Two providers can return the same place, and one provider returns a POI plus its
// own sub-features — "Central Park" comes back as the mall, its musical fountain,
// its parking basement and its loading dock, spread over ~250m. Offering those as
// separate destinations is noise, not a decision: for driving directions they are
// the same arrival, on the same roads, in the same weather. Cluster by real
// distance (rounding coordinates would split pairs across a boundary) and keep the
// highest-ranked of each cluster.
const NEAR_DUPLICATE_KM = 0.4;

// Two entries reading exactly "Grand Orchard, Jakarta, Indonesia" are not a
// choice the user can make — whatever distinguishes them isn't on screen, so
// picking is a coin flip. Identical labels collapse no matter how far apart they
// sit; only the highest-ranked survives.
const sameLabel = (a, b) => (a.label || a.name || '').toLowerCase() === (b.label || b.name || '').toLowerCase();

const dedupe = (list) =>
  list.reduce((keep, c) => {
    if (!keep.some((k) => distanceKm(k, c) < NEAR_DUPLICATE_KM || sameLabel(k, c))) keep.push(c);
    return keep;
  }, []);

const fromPhoton = (f) => {
  const p = f.properties || {};
  const [lon, lat] = f.geometry.coordinates;
  const name = p.name || p.street || p.city;
  if (!name || !Number.isFinite(lat)) return null;
  return {
    name,
    label: [name, p.city || p.state, p.country].filter(Boolean).join(', '),
    lat,
    lon,
    // For ranking (utils/placeRank.js), stripped again before results leave here.
    kind: p.osm_key && `${p.osm_key}=${p.osm_value}`,
    area: [p.district, p.locality, p.city, p.county, p.state].filter(Boolean).join(' '),
  };
};

const fromNominatim = (l) => ({
  name: l.name || shortName(l.display_name),
  label: nominatimLabel(l.display_name),
  lat: parseFloat(l.lat),
  lon: parseFloat(l.lon),
  kind: l.class && `${l.class}=${l.type}`,
  importance: Number(l.importance) || 0,
  area: l.display_name,
  alias: true,
});

// Callers get plain places, as before.
const slim = ({ name, label, lat, lon, source }) => ({ name, label, lat, lon, ...(source ? { source } : {}) });

/* ---------------- Google Maps links ---------------- */

// Coordinates appear in a few shapes:
//   /maps/place/Name/@-6.19,106.82,17z    ← the @ pin
//   /maps?q=-6.19,106.82  ·  ?ll=  ·  ?destination=
//   !3d-6.19!4d106.82                     ← embedded place data
const COORD_PATTERNS = [
  /@(-?\d+\.\d+),(-?\d+\.\d+)/,
  /[?&](?:q|ll|sll|daddr|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/,
  /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
];

const nameFromMapsUrl = (url) => {
  const m = url.match(/\/maps\/place\/([^/@]+)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1].replace(/\+/g, ' ')).trim() || null;
  } catch {
    return null;
  }
};

export const coordsFromMapsUrl = (url) => {
  for (const re of COORD_PATTERNS) {
    const m = url.match(re);
    if (m) {
      const lat = parseFloat(m[1]);
      const lon = parseFloat(m[2]);
      if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        return { name: nameFromMapsUrl(url) || 'Dropped pin', label: nameFromMapsUrl(url) || url, lat, lon };
      }
    }
  }
  return null;
};

// Short links (maps.app.goo.gl, goo.gl/maps) carry no coordinates — they have to
// be followed. The browser can't read a cross-origin redirect, so the backend
// does it.
export const resolveMapsUrl = async (url) => {
  const direct = coordsFromMapsUrl(url);
  if (direct) return direct;
  try {
    const res = await fetch(`/api/resolve?url=${encodeURIComponent(url)}`);
    if (res.ok) {
      const l = await res.json();
      if (l && typeof l.lat === 'number') return l;
    }
  } catch {
    /* backend down — nothing else can follow the redirect */
  }
  return null;
};

/* ---------------- geocoding ---------------- */

// Each source is asked for well over the display cap: dedupe collapses a POI and
// its sub-features into one entry, so a request for 6 routinely came back as 2.
const PROVIDER_LIMIT = 15;

/*
 * Ranked candidates for a place name.
 *
 * Sources are tried in order of how well they answer this kind of query, but a
 * source that returns *something* no longer ends the search: Photon indexes POIs
 * far better while Nominatim is stronger on plain place names, and stopping at
 * the first hit meant a mall search never saw the district of the same name.
 * Results are concatenated in provider order — so the best source still ranks
 * first — and deduped across the whole set by real distance.
 *
 * Collection stops once `limit` distinct places exist, so the common case still
 * costs a single request.
 */
export const geocodeCandidates = async (query, near, limit = MAX_CANDIDATES) => {
  const at = biased(near) ? `&near=${near.lat},${near.lon}` : '';
  const atLatLon = biased(near) ? `&lat=${near.lat}&lon=${near.lon}` : '';

  // Two bounds, because each alone failed. A fresh 8s signal per source let four
  // stalled sources pin the turn for 4 x 8s (and a route turn geocodes twice). ONE
  // shared 8s signal fixed that but let the first source starve the rest: the
  // /api/geocode proxy is slow-but-healthy (it runs Photon 8s + Nominatim 8s
  // server-side, ~16s worst case), so it alone spent the whole budget and direct
  // Photon was never tried. So: each source gets at most SOURCE_MS (5s - enough for
  // a healthy proxy or Photon, short enough to move on from a stall), and the whole
  // attempt is capped at TOTAL_MS (12s - a stalled first source still leaves room
  // for two more full sources, and busy is pinned for ~12s, not ~32s).
  const SOURCE_MS = 5000;
  const TOTAL_MS = 12000;
  const MIN_SOURCE_MS = 1000; // under this there is no point starting another request
  const deadline = Date.now() + TOTAL_MS;
  let signal;
  const sources = [
    // 1) Backend proxy (reliable, sends a proper User-Agent to the geocoders).
    async () => {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}&limit=${PROVIDER_LIMIT}${at}`, { signal });
      if (!res.ok) return [];
      const body = await res.json();
      return (body.candidates || []).filter((c) => typeof c.lat === 'number');
    },
    // 2) Direct Photon — strongest on POIs.
    async () => {
      const res = await fetch(`${PHOTON}?q=${encodeURIComponent(query)}&limit=${PROVIDER_LIMIT}&lang=en${atLatLon}`, { signal });
      if (!res.ok) return [];
      return ((await res.json()).features || []).map(fromPhoton).filter(Boolean);
    },
    // 3) Direct Nominatim, most significant first — otherwise a minor hamlet
    //    outranks the city of the same name.
    async () => {
      const url = `${NOMINATIM}?q=${encodeURIComponent(query)}&format=json&limit=${PROVIDER_LIMIT}&addressdetails=0${viewboxOf(near)}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' }, signal });
      if (!res.ok) return [];
      return [...(await res.json())].sort((a, b) => (b.importance || 0) - (a.importance || 0)).map(fromNominatim);
    },
    // 4) WeatherAPI city search — plain place names only.
    async () => {
      const res = await fetch(`${WEATHER_BASE_URL}/search.json?key=${WEATHER_API_KEY}&q=${encodeURIComponent(query)}`, { signal });
      if (!res.ok) return [];
      return (await res.json()).map((l) => ({
        name: l.name,
        label: [l.name, l.region, l.country].filter(Boolean).join(', '),
        lat: l.lat,
        lon: l.lon,
      }));
    },
  ];

  const found = [];
  let proxied = false;
  for (const [i, load] of sources.entries()) {
    // Overall deadline gone -> stop. A single source timing out is NOT this case:
    // it just ends that source's own signal and the loop moves on to the next.
    const remaining = deadline - Date.now();
    if (remaining < MIN_SOURCE_MS) break;
    signal = upstreamSignal(Math.min(SOURCE_MS, remaining));
    try {
      const got = await load();
      if (i === 0 && got.length) proxied = true;
      found.push(...got);
    } catch {
      /* this source failed or timed out - try the next one */
    }
    // Dedupe as we go: 15 raw hits can collapse to 3 real places, and only the
    // deduped count tells us whether it's worth asking anyone else.
    if (dedupe(found).length >= limit) break;
  }

  // The backend already ranked its answer the way Google does; keep that order.
  // Without it, rank the direct results here with the same rules.
  const ordered = proxied ? found : rankPlaces(query, found, biased(near) ? near : null);
  return dedupe(ordered).slice(0, limit).map(slim);
};

export const geocode = async (query, near) => (await geocodeCandidates(query, near, 1))[0] || null;

/* ---------------- as-you-type suggestions ---------------- */

// As-you-type suggestions must never reach Nominatim: its usage policy
// prohibits autocomplete-style querying, and a request per keystroke risks
// getting the app's Vercel IPs blocked, which would break the explicit search
// too. Photon is already called straight from the browser as source #2 above,
// so this reuses that same direct call rather than growing the backend proxy
// with a "suggest-only" mode — Photon is built for exactly this use case.
const SUGGEST_LIMIT = 6;

export const photonSuggest = async (query, near, signal) => {
  const atLatLon = biased(near) ? `&lat=${near.lat}&lon=${near.lon}` : '';
  const at = biased(near) ? near : null;
  const load = async (lang) => {
    const res = await fetch(
      `${PHOTON}?q=${encodeURIComponent(query)}&limit=${PROVIDER_LIMIT}&lang=${lang}${atLatLon}`,
      { signal }
    );
    if (!res.ok) return [];
    return ((await res.json()).features || []).map(fromPhoton).filter(Boolean);
  };
  try {
    let found = await load('en');
    // Same ranking as a full search: the mall before its parking lot, and none
    // of Photon's word-less guesses ("Ciater Udik" → Cisterna, Italy).
    let ranked = rankPlaces(query, found, at);
    // English names can hide the one people type: "Kebun Raya Bogor" comes back
    // as "Bogor Botanical Gardens". When the leader looks doubtful, ask again for
    // local names and rank both together (one extra request, only then).
    // Nothing at all won't change with a different display language: Photon
    // already searched every name each place has.
    if (found.length && needsMore(query, ranked, at)) {
      found = found.concat(await load('default'));
      ranked = rankPlaces(query, found, at);
    }
    return dedupe(ranked).slice(0, SUGGEST_LIMIT).map(slim);
  } catch {
    // Network failure or an aborted (superseded) request — either way stay
    // silent here; only the explicit submit search reports errors.
    return [];
  }
};

// Google Places suggestions through the backend proxy (the key lives there).
// The proxy answers 501 when no Google key is configured; that, or a backend
// that isn't running, parks Google for a while so typing doesn't pay for a
// failing request on every keystroke, and Photon carries the suggestions.
const GOOGLE_RETRY_MS = 5 * 60 * 1000;
let googleOffUntil = 0;

export const resetPlaceSuggest = () => {
  googleOffUntil = 0;
};

export const placeSuggest = async (query, near, signal) => {
  if (Date.now() >= googleOffUntil) {
    const at = biased(near) ? `&near=${near.lat},${near.lon}` : '';
    try {
      const res = await fetch(
        `/api/geocode?q=${encodeURIComponent(query)}&limit=${SUGGEST_LIMIT}&mode=suggest${at}`,
        { signal }
      );
      if (res.ok) {
        const body = await res.json();
        const list = (body.candidates || []).filter((c) => typeof c.lat === 'number' && typeof c.lon === 'number');
        if (list.length) return dedupe(list).slice(0, SUGGEST_LIMIT);
        // Google found nothing for this text: Photon may still know it.
      } else {
        googleOffUntil = Date.now() + GOOGLE_RETRY_MS;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return []; // superseded by newer typing
      googleOffUntil = Date.now() + GOOGLE_RETRY_MS;
    }
  }
  return photonSuggest(query, near, signal);
};

// A suggestion click stores the picked place alongside the exact text it wrote
// into the field. If the user edits that text afterward, the picked pin may no
// longer be what the (now different) string describes, so a caller about to
// trust a stored pick must first confirm the field still reads exactly what
// the pick produced — otherwise a stale pin outlives the text it came from.
export const pickIsCurrent = (pick, text) => !!pick && pick.text === (text ?? '').trim();

const MIN_SUGGEST_LEN = 3;
const SUGGEST_DEBOUNCE_MS = 300;

// Owns the debounce + cancellation so the component doesn't have to: a slow
// response for "pon" must never land after — and overwrite — the list for
// "pontianak". Every call aborts whatever request is still in flight *and*
// stamps a sequence number, so even a response that slips past the abort
// (e.g. a fetch that ignores its signal) is still discarded once it's stale.
// Any http(s) link, not just Google Maps ones — none of them belong in a
// place-name geocoder. Same shape as intents.js's parseMapsUrl, kept local so
// the service layer doesn't import from the chat layer.
export const looksLikeUrl = (text) => /https?:\/\/\S+/i.test(text || '');

// `source` defaults to Photon-only; the app's search boxes pass placeSuggest so
// Google answers first when the backend has a key.
export const createSuggestTypeahead = ({
  minLength = MIN_SUGGEST_LEN,
  debounceMs = SUGGEST_DEBOUNCE_MS,
  source = photonSuggest,
} = {}) => {
  let timer = null;
  let controller = null;
  let seq = 0;

  const cancel = () => {
    clearTimeout(timer);
    controller?.abort();
    seq += 1;
  };

  const run = (query, near, onResult) => {
    cancel();
    const text = (query || '').trim();
    // A pasted link is resolved at submit time (resolveInput), never geocoded
    // as-you-type: sending it to Photon leaks the URL to a third party and
    // pops junk suggestions over the form. Clear any open list instead.
    if (looksLikeUrl(text) || text.length < minLength) {
      onResult([]);
      return;
    }
    const mySeq = seq;
    timer = setTimeout(async () => {
      controller = new AbortController();
      const list = await source(text, near, controller.signal);
      if (mySeq === seq) onResult(list);
    }, debounceMs);
  };

  return { run, cancel };
};
