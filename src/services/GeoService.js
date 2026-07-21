// Place lookup for the chat. Returns a ranked *list* of candidates so the caller
// can ask the user which one they meant instead of silently betting on the top
// hit — "Grand Indonesia" legitimately matches a mall, a sky bridge and an
// estate agent's office 27km away.
//
// Providers, in order: backend proxy → Photon → Nominatim → WeatherAPI search.
// Both OSM geocoders read the same data, but Photon indexes POIs far better,
// while Nominatim is the more reliable fallback for plain place names.
import { WEATHER_API_KEY, WEATHER_BASE_URL } from './config';

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
  return { name, label: [name, p.city || p.state, p.country].filter(Boolean).join(', '), lat, lon };
};

const fromNominatim = (l) => ({
  name: l.name || shortName(l.display_name),
  label: shortName(l.display_name),
  lat: parseFloat(l.lat),
  lon: parseFloat(l.lon),
});

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

  const sources = [
    // 1) Backend proxy (reliable, sends a proper User-Agent to the geocoders).
    async () => {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}&limit=${PROVIDER_LIMIT}${at}`);
      if (!res.ok) return [];
      const body = await res.json();
      return (body.candidates || []).filter((c) => typeof c.lat === 'number');
    },
    // 2) Direct Photon — strongest on POIs.
    async () => {
      const res = await fetch(`${PHOTON}?q=${encodeURIComponent(query)}&limit=${PROVIDER_LIMIT}&lang=en${atLatLon}`);
      if (!res.ok) return [];
      return ((await res.json()).features || []).map(fromPhoton).filter(Boolean);
    },
    // 3) Direct Nominatim, most significant first — otherwise a minor hamlet
    //    outranks the city of the same name.
    async () => {
      const url = `${NOMINATIM}?q=${encodeURIComponent(query)}&format=json&limit=${PROVIDER_LIMIT}&addressdetails=0${viewboxOf(near)}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) return [];
      return [...(await res.json())].sort((a, b) => (b.importance || 0) - (a.importance || 0)).map(fromNominatim);
    },
    // 4) WeatherAPI city search — plain place names only.
    async () => {
      const res = await fetch(`${WEATHER_BASE_URL}/search.json?key=${WEATHER_API_KEY}&q=${encodeURIComponent(query)}`);
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
  for (const load of sources) {
    try {
      found.push(...(await load()));
    } catch {
      /* try the next source */
    }
    // Dedupe as we go: 15 raw hits can collapse to 3 real places, and only the
    // deduped count tells us whether it's worth asking anyone else.
    if (dedupe(found).length >= limit) break;
  }

  return dedupe(found).slice(0, limit);
};

export const geocode = async (query, near) => (await geocodeCandidates(query, near, 1))[0] || null;
