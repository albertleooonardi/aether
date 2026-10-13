// Places the user actually picked, newest first, so a search box can offer them
// again before anything is typed. Browser-local and best-effort: private mode or
// blocked storage just means no recents, never an error.
import { samePlace } from '../utils/Suggestions';

const KEY = 'aether.recentPlaces.v1';
const MAX = 8;

// Placeholder names carry no meaning when offered back in a list.
const GENERIC = /^(my location|your location|dropped pin|selected point)$/i;

const valid = (p) =>
  p && typeof p.name === 'string' && p.name.trim() && Number.isFinite(p.lat) && Number.isFinite(p.lon);

export const loadRecents = () => {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.filter(valid) : [];
  } catch {
    return [];
  }
};

const save = (list) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* not persisting is survivable */
  }
  return list;
};

export const addRecent = (place) => {
  if (!valid(place) || GENERIC.test(place.name.trim())) return loadRecents();
  const clean = { name: place.name.trim(), label: place.label || place.name, lat: place.lat, lon: place.lon };
  return save([clean, ...loadRecents().filter((p) => !samePlace(p, clean))].slice(0, MAX));
};

export const removeRecent = (place) => save(loadRecents().filter((p) => !samePlace(p, place)));
