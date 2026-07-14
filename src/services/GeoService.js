// Geocoding via OpenStreetMap Nominatim (free, no key) — resolves both cities and
// landmarks/POIs like "Grand Indonesia". Falls back to WeatherAPI search for
// plain city names if Nominatim is unavailable.
import { WEATHER_API_KEY, WEATHER_BASE_URL } from './config';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

const shortName = (displayName) => displayName.split(',').slice(0, 2).join(',').trim();

// Nominatim ranks globally, so an unbiased "Grand Indonesia" resolves to a
// consulate in Ghana. `near` ({lat,lon}) prefers candidates within a day's drive;
// the box is a preference, not a bound (no `bounded=1`), so distant cities still
// resolve. Among the survivors take the highest `importance` rather than the
// first hit, or a minor hamlet outranks the city of the same name.
const VIEW_DEG = 3;

const viewboxOf = (near) =>
  near && Number.isFinite(near.lat) && Number.isFinite(near.lon)
    ? `&viewbox=${near.lon - VIEW_DEG},${near.lat - VIEW_DEG},${near.lon + VIEW_DEG},${near.lat + VIEW_DEG}`
    : '';

const mostImportant = (arr) =>
  arr.reduce((a, b) => ((b.importance || 0) > (a.importance || 0) ? b : a));

export const geocode = async (query, near) => {
  const bias = near && Number.isFinite(near.lat) ? `&near=${near.lat},${near.lon}` : '';

  // 1) Backend proxy (reliable, sends a proper User-Agent to Nominatim).
  try {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}${bias}`);
    if (res.ok) {
      const l = await res.json();
      if (l && typeof l.lat === 'number') return l;
    }
  } catch {
    /* backend down → fall back to direct calls below */
  }

  // 2) Direct Nominatim.
  try {
    const url = `${NOMINATIM}?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=0${viewboxOf(near)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (res.ok) {
      const arr = await res.json();
      if (arr.length) {
        const l = mostImportant(arr);
        return {
          name: l.name || shortName(l.display_name),
          label: shortName(l.display_name),
          lat: parseFloat(l.lat),
          lon: parseFloat(l.lon),
        };
      }
    }
  } catch {
    /* fall through to WeatherAPI */
  }

  // Fallback: WeatherAPI city search.
  try {
    const res = await fetch(
      `${WEATHER_BASE_URL}/search.json?key=${WEATHER_API_KEY}&q=${encodeURIComponent(query)}`
    );
    if (res.ok) {
      const arr = await res.json();
      if (arr.length) {
        const l = arr[0];
        return {
          name: l.name,
          label: [l.name, l.country].filter(Boolean).join(', '),
          lat: l.lat,
          lon: l.lon,
        };
      }
    }
  } catch {
    /* ignore */
  }

  return null;
};
