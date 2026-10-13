// Builds the grouped list a search box shows: recommendations before anything
// is typed (your location, recent places, nearby cities), instant local matches
// while typing, and the geocoder's results merged in underneath once they land.
// Pure functions, so the map and the weather search share one behaviour.
import { distanceKm } from '../services/GeoService';

// Lowercase and strip accents, so "sao" finds "São Paulo". Stripping combining
// marks from NFD text keeps the same length as the NFC input for precomposed
// letters, which is what lets highlightParts reuse the index on the original.
export const norm = (s) =>
  (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

// 3: the name starts with the query · 2: a word in the name does · 1: the
// longer label contains it anywhere · 0: no match.
export const matchRank = (place, query) => {
  const q = norm(query).trim();
  if (!q) return 0;
  const name = norm(place.name);
  if (name.startsWith(q)) return 3;
  if (name.split(/[\s,\-/]+/).some((w) => w.startsWith(q))) return 2;
  if (norm(place.label).includes(q)) return 1;
  return 0;
};

// Splits text around the first case/accent-insensitive occurrence of query.
export const highlightParts = (text, query) => {
  const value = text || '';
  const q = norm(query).trim();
  const at = q ? norm(value).indexOf(q) : -1;
  if (at < 0) return [{ text: value, match: false }];
  return [
    { text: value.slice(0, at), match: false },
    { text: value.slice(at, at + q.length), match: true },
    { text: value.slice(at + q.length), match: false },
  ].filter((p) => p.text);
};

const finite = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon);

// The same place, as far as a person picking from a list is concerned: within
// 400m of each other, or the same name within the same metro area.
export const samePlace = (a, b) => {
  if (!finite(a) || !finite(b)) return false;
  const d = distanceKm(a, b);
  return d < 0.4 || (norm(a.name) === norm(b.name) && d < 25);
};

export const formatDistance = (km) => {
  if (!Number.isFinite(km)) return '';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString('en-US')} km`;
};

export const cityPlace = (c) => ({ name: c.name, label: `${c.name}, ${c.country}`, lat: c.lat, lon: c.lon });

const subtitleOf = (p) => (p.label && p.label !== p.name ? p.label : null);

const placeItem = (type, place, extra = {}) => ({
  key: `${type}:${place.lat.toFixed(4)},${place.lon.toFixed(4)}`,
  type,
  title: place.name,
  subtitle: subtitleOf(place),
  place,
  ...extra,
});

export const LOCATE_ITEM = {
  key: 'locate',
  type: 'locate',
  title: 'Your location',
  subtitle: 'Use your device location',
};

/*
 * Groups shown from local data alone, so the menu opens instantly.
 *   empty query → [Your location] · Recent · Nearby (or Popular without a bias point)
 *   typed query → Suggestions: recents and cities that match, recents first
 */
export const buildLocalGroups = ({
  query = '',
  recents = [],
  cities = [],
  near = null,
  locate = false,
  max = 5,
  recentMax = 4,
} = {}) => {
  const q = norm(query).trim();

  if (!q) {
    const groups = [];
    if (locate) groups.push({ id: 'locate', title: null, items: [LOCATE_ITEM] });

    const recent = recents.filter(finite).slice(0, recentMax);
    if (recent.length) {
      groups.push({
        id: 'recent',
        title: 'Recent',
        items: recent.map((p) => placeItem('recent', p, { removable: true })),
      });
    }

    const pool = cities.map(cityPlace).filter((c) => !recent.some((r) => samePlace(r, c)));
    if (finite(near)) {
      const nearest = pool
        .map((p) => ({ p, d: distanceKm(near, p) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, max);
      if (nearest.length) {
        groups.push({
          id: 'nearby',
          title: 'Nearby',
          items: nearest.map(({ p, d }) => placeItem('city', p, { meta: formatDistance(d) })),
        });
      }
    } else if (pool.length) {
      groups.push({ id: 'popular', title: 'Popular', items: pool.slice(0, max).map((p) => placeItem('city', p)) });
    }
    return groups;
  }

  const scored = [
    ...recents.filter(finite).map((p) => ({ p, type: 'recent', bonus: 0.5 })),
    ...cities.map((c) => ({ p: cityPlace(c), type: 'city', bonus: 0 })),
  ]
    .map((x) => ({ ...x, rank: matchRank(x.p, q) }))
    .filter((x) => x.rank > 0)
    .sort((a, b) => b.rank + b.bonus - (a.rank + a.bonus));

  const kept = [];
  scored.forEach((x) => {
    if (kept.length < max && !kept.some((k) => samePlace(k.p, x.p))) kept.push(x);
  });
  if (!kept.length) return [];
  return [
    {
      id: 'matches',
      title: 'Suggestions',
      items: kept.map((x) => placeItem(x.type, x.p, x.type === 'recent' ? { removable: true } : {})),
    },
  ];
};

// Appends geocoder results, minus anything a local group already offers.
export const mergeRemote = (groups, remote = [], title = 'Places') => {
  const shown = groups.flatMap((g) => g.items).filter((i) => i.place).map((i) => i.place);
  const items = remote
    .filter(finite)
    .filter((p) => !shown.some((s) => samePlace(s, p)))
    .map((p) => placeItem('place', p));
  return items.length ? [...groups, { id: 'remote', title, items }] : groups;
};

export const flatItems = (groups) => groups.flatMap((g) => g.items);
