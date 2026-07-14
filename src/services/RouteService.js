// Driving routes via OSRM public server (free, no key) + rain assessment along
// each alternative using WeatherAPI current conditions at sampled points.
import { fetchCurrent } from './WeatherService';

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
  const url = `${OSRM}/${origin.lon},${origin.lat};${dest.lon},${dest.lat}?alternatives=true&overview=full&geometries=geojson`;
  return readOsrm(await fetch(url));
};

const finite = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon);

export const getRoutes = async (origin, dest) => {
  if (!finite(origin) || !finite(dest)) throw routeError('Missing map coordinates', 'bad_coords');

  const data = await fetchOsrm(origin, dest);
  if (data.code === 'NoRoute') throw routeError('No driving route between those places', 'no_route');
  if (data.code !== 'Ok' || !data.routes?.length) throw routeError('No route found', 'no_route');

  return data.routes.slice(0, 3).map((r) => ({
    // GeoJSON is [lng, lat]; Leaflet wants [lat, lng].
    coordinates: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    distanceKm: r.distance / 1000,
    durationMin: r.duration / 60,
  }));
};

// Evenly sample a handful of points along the route (skipping the shared origin).
const samplePoints = (coords, count = 3) => {
  const pts = [];
  for (let i = 1; i <= count; i++) {
    const idx = Math.min(coords.length - 1, Math.round((coords.length - 1) * (i / count)));
    pts.push(coords[idx]);
  }
  return pts;
};

export const assessRain = async (route) => {
  const points = samplePoints(route.coordinates, 3);
  let precip = 0;
  let rainy = 0;
  let samples = 0;

  await Promise.all(
    points.map(async ([lat, lon]) => {
      try {
        const d = await fetchCurrent(`${lat},${lon}`);
        precip += d.current.precip_mm || 0;
        if ((d.current.condition.text || '').toLowerCase().includes('rain')) rainy += 1;
        samples += 1;
      } catch {
        /* skip failed sample */
      }
    })
  );

  const score = precip + rainy;
  const level = score <= 0.2 ? 'dry' : score < 2 ? 'light' : 'wet';
  return { precip: Math.round(precip * 10) / 10, rainy, samples, score, level };
};

// Fetch routes then assess rain on each; returns routes + index of the driest.
export const getRoutesWithRain = async (origin, dest) => {
  const routes = await getRoutes(origin, dest);
  const assessed = await Promise.all(
    routes.map(async (r) => ({ ...r, rain: await assessRain(r) }))
  );
  let bestIndex = 0;
  assessed.forEach((r, i) => {
    if (r.rain.score < assessed[bestIndex].rain.score) bestIndex = i;
  });
  return { routes: assessed, bestIndex };
};
