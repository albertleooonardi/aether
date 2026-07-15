// Driving routes via OSRM public server (free, no key), with rain judged from the
// hourly forecast at the time the driver would actually reach each stretch — not
// from conditions at the moment they asked. On a 40-minute drive those differ.
//
// Caveat worth knowing: the public OSRM has no live traffic, so its durations are
// free-flow and optimistic in a congested city. ETAs inherit that. Swapping in a
// traffic-aware routing provider would improve the timings without changing any
// of the logic here.
import { fetchForecastHours } from './WeatherService';

// `annotations=duration` returns OSRM's own per-node timings, which is what makes
// a real per-stretch ETA possible instead of assuming a constant speed.
const OSRM_OPTS = 'alternatives=true&overview=full&geometries=geojson&annotations=duration';
const OSRM = 'https://router.project-osrm.org/route/v1/driving';

export const routeError = (message, code) => Object.assign(new Error(message), { code });

// OSRM answers "these points aren't connected by road" with HTTP 400 + a JSON
// body ({ code: 'NoRoute' }), so a non-OK status alone does NOT mean the service
// is down. Always read the body first: a payload carrying `code` is a real
// answer, and only a bodyless failure (5xx, rate-limit, network) is an outage.
const readOsrm = async (res) => {
  const data = await res.json().catch(() => null);
  if (data && data.code) return data;
  throw routeError('Routing service unavailable', 'unavailable');
};

// Prefer the backend proxy (server-side, retried, no browser rate-limit); fall
// back to calling the public OSRM demo directly if the backend isn't running.
const fetchOsrm = async (origin, dest) => {
  try {
    const res = await fetch(`/api/route?from=${origin.lat},${origin.lon}&to=${dest.lat},${dest.lon}`);
    const data = await res.json().catch(() => null);
    if (data && data.code) return data;
  } catch {
    /* backend down → fall back */
  }
  const url = `${OSRM}/${origin.lon},${origin.lat};${dest.lon},${dest.lat}?${OSRM_OPTS}`;
  return readOsrm(await fetch(url));
};

const finite = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon);

// Seconds from departure to each vertex of the line. OSRM's per-node annotations
// follow real road speeds, so the ETA for a stretch reflects the motorway/backroad
// mix rather than an average smeared over the whole trip.
const etaPerVertex = (r, n) => {
  const per = (r.legs || []).flatMap((l) => l.annotation?.duration || []);
  const cum = new Array(n).fill(0);
  if (per.length >= n - 1) {
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + (per[i - 1] || 0);
    return cum;
  }
  // No annotations (a proxy that didn't request them, or a cached reply): spread
  // the total evenly. Coarser, but far better than treating arrival as instant.
  for (let i = 1; i < n; i++) cum[i] = ((r.duration || 0) * i) / (n - 1);
  return cum;
};

export const getRoutes = async (origin, dest) => {
  if (!finite(origin) || !finite(dest)) throw routeError('Missing map coordinates', 'bad_coords');

  const data = await fetchOsrm(origin, dest);
  if (data.code === 'NoRoute') throw routeError('No driving route between those places', 'no_route');
  if (data.code !== 'Ok' || !data.routes?.length) throw routeError('No route found', 'no_route');

  return data.routes.slice(0, 3).map((r) => {
    // GeoJSON is [lng, lat]; Leaflet wants [lat, lng].
    const coordinates = r.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    return {
      coordinates,
      distanceKm: r.distance / 1000,
      durationMin: r.duration / 60,
      etaSeconds: etaPerVertex(r, coordinates.length),
    };
  });
};

// Rain isn't uniform over a route, so the route is cut into contiguous chunks and
// each is sampled at its own midpoint — that's what lets the map paint the wet
// stretch red and leave the rest green. Chunks share their boundary vertex, so
// the drawn segments join without gaps.
//
// Longer trips get more chunks, but the count is capped: every chunk is one
// WeatherAPI call, times every alternative route.
const MIN_CHUNKS = 3;
const MAX_CHUNKS = 8;
const KM_PER_CHUNK = 10;

// A missing distance must not collapse the route to zero chunks — that would
// silently skip every sample and report "unknown".
const chunkCount = (km) =>
  Number.isFinite(km) ? Math.min(MAX_CHUNKS, Math.max(MIN_CHUNKS, Math.round(km / KM_PER_CHUNK))) : MIN_CHUNKS;

const chunksOf = (len, n) =>
  Array.from({ length: n }, (_, i) => {
    const from = Math.floor((i * (len - 1)) / n);
    const to = Math.floor(((i + 1) * (len - 1)) / n);
    return { from, to, mid: Math.floor((from + to) / 2) };
  });

// WeatherAPI condition codes below 1150 are dry states (clear, cloud, haze, fog)
// plus the "nearby" forecasts — 1063 "Patchy rain nearby", 1087 "Thundery
// outbreaks in nearby" — which report rain *around* the point, not on it. Codes
// 1150+ are precipitation actually falling, with no exceptions in WeatherAPI's
// published list.
//
// The old check was condition.text.includes('rain'), which was wrong both ways:
// it counted "Patchy rain nearby" (the default daytime condition across much of
// the tropics, so every route scored wet) and missed drizzle and sleet, whose
// labels never contain the word "rain".
const isPrecipitating = (code) => code >= 1150;

// A forecast hour carries both an amount and a probability, and they answer
// different questions. "40% chance, 0mm" means it might rain and probably won't
// amount to much; "0.8mm expected" means it will. Treating a low chance with no
// accumulation as rain is how you end up warning about every trip.
const HEAVY_MM = 0.5;
const CHANCE_LIGHT = 30;
const CHANCE_WET = 60;

const levelAt = (precip, chance, raining) => {
  if (!raining && chance < CHANCE_LIGHT && precip <= 0.2) return 'dry';
  return precip >= HEAVY_MM || chance >= CHANCE_WET ? 'wet' : 'light';
};

// The hour bucket covering an instant. time_epoch is a true UTC instant, so this
// works regardless of the driver's timezone or the destination's.
const hourAt = (hours, ms) => {
  const t = Math.floor(ms / 1000);
  return hours.find((h) => t >= h.time_epoch && t < h.time_epoch + 3600) || null;
};

// `departAt` is when the driver leaves; each stretch is then judged at its own
// arrival time, which is the whole point — the far end of a 40-minute drive is
// asked about 40 minutes from now, not now.
export const assessRain = async (route, departAt = Date.now()) => {
  const coords = route.coordinates;
  const chunks = chunksOf(coords.length, chunkCount(route.distanceKm));

  const sampled = await Promise.all(
    chunks.map(async (c) => {
      const [lat, lon] = coords[c.mid];
      const at = departAt + (route.etaSeconds?.[c.mid] || 0) * 1000;
      try {
        const hours = await fetchForecastHours(`${lat},${lon}`);
        const h = hourAt(hours, at);
        // Beyond the forecast horizon — don't guess.
        if (!h) return { ...c, at, precip: 0, chance: 0, raining: false, level: 'unknown', ok: false };

        const precip = h.precip_mm || 0;
        const chance = h.chance_of_rain ?? 0;
        const raining = isPrecipitating(h.condition?.code);
        return { ...c, at, precip, chance, raining, level: levelAt(precip, chance, raining), ok: true };
      } catch {
        return { ...c, at, precip: 0, chance: 0, raining: false, level: 'unknown', ok: false };
      }
    })
  );

  const ok = sampled.filter((s) => s.ok);
  const segments = sampled.map(({ from, to, level, at, chance, precip }) => ({ from, to, level, at, chance, precip }));

  // No sample survived (WeatherAPI down or out of quota) — say so rather than
  // scoring 0 and promising a dry trip we never checked.
  if (!ok.length) {
    return { precip: 0, chance: 0, rainy: 0, samples: 0, score: Infinity, level: 'unknown', segments };
  }

  const precip = ok.reduce((s, r) => s + r.precip, 0);
  const chance = ok.reduce((s, r) => s + r.chance, 0);
  const rainy = ok.filter((r) => r.level !== 'dry').length;

  // Averaged, not summed: a longer route gets more samples, and a summed score
  // would make it look wetter than a short one in identical weather. Probability
  // is part of the score so two dry-looking routes still rank by their risk.
  const score = precip / ok.length + chance / ok.length / 100;

  // The route reads as bad as its worst stretch — driving through one downpour
  // still means taking an umbrella.
  const level = ok.some((s) => s.level === 'wet')
    ? 'wet'
    : ok.some((s) => s.level === 'light')
    ? 'light'
    : 'dry';

  return {
    precip: Math.round(precip * 10) / 10,
    chance: Math.round(chance / ok.length),
    rainy,
    samples: ok.length,
    score,
    level,
    segments,
  };
};

// Fetch routes then assess rain on each; returns routes + index of the driest.
export const getRoutesWithRain = async (origin, dest, departAt = Date.now()) => {
  const routes = await getRoutes(origin, dest);
  const assessed = await Promise.all(
    routes.map(async (r) => ({
      ...r,
      departAt,
      arriveAt: departAt + (r.durationMin || 0) * 60000,
      rain: await assessRain(r, departAt),
    }))
  );
  let bestIndex = 0;
  assessed.forEach((r, i) => {
    if (r.rain.score < assessed[bestIndex].rain.score) bestIndex = i;
  });
  return { routes: assessed, bestIndex };
};
