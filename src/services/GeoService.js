// Geocoding via OpenStreetMap Nominatim (free, no key) — resolves both cities and
// landmarks/POIs like "Grand Indonesia". Falls back to WeatherAPI search for
// plain city names if Nominatim is unavailable.
import { WEATHER_API_KEY, WEATHER_BASE_URL } from './config';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

const shortName = (displayName) => displayName.split(',').slice(0, 2).join(',').trim();

export const geocode = async (query) => {
  // 1) Backend proxy (reliable, sends a proper User-Agent to Nominatim).
  try {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
    if (res.ok) {
      const l = await res.json();
      if (l && typeof l.lat === 'number') return l;
    }
  } catch {
    /* backend down → fall back to direct calls below */
  }

  // 2) Direct Nominatim.
  try {
    const url = `${NOMINATIM}?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=0`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (res.ok) {
      const arr = await res.json();
      if (arr.length) {
        const l = arr[0];
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
