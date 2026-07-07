// Saved-route store (localStorage).
import { buildLoopAround, totalDistanceKm } from './geo';

const KEY = 'vrijeme.routes.v1';
const PACE = { walk: 12, run: 6, bike: 3 }; // min per km
const uid = () => `route_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

export const loadRoutes = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
};

const persist = (routes) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(routes));
  } catch {
    /* ignore */
  }
};

export const upsertRoute = (route) => {
  const routes = loadRoutes();
  const idx = routes.findIndex((r) => r.id === route.id);
  if (idx >= 0) routes[idx] = route;
  else routes.push(route);
  persist(routes);
  return routes;
};

export const deleteRoute = (id) => {
  const routes = loadRoutes().filter((r) => r.id !== id);
  persist(routes);
  return routes;
};

export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export const normalizeActivity = (word) => {
  if (/walk/.test(word)) return 'walk';
  if (/bike|bik|cycl/.test(word)) return 'bike';
  return 'run';
};

// Create a demo loop anchored at the given center.
export const createRoute = (center, activity = 'run', name) => {
  const radiusKm = activity === 'bike' ? 2.4 : activity === 'walk' ? 0.7 : 1.1;
  const polyline = buildLoopAround(center, radiusKm);
  const route = {
    id: uid(),
    name: name || `${cap(activity)} near you`,
    activityType: activity,
    polyline,
    avgPaceMinPerKm: PACE[activity],
    distanceKm: totalDistanceKm(polyline),
  };
  upsertRoute(route);
  return route;
};
