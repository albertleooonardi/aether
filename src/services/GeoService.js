// Geocoding via OpenStreetMap Nominatim (free, no key) — resolves both cities and
// landmarks/POIs like "Grand Indonesia". Falls back to WeatherAPI search for
// plain city names if Nominatim is unavailable.
import { WEATHER_API_KEY, WEATHER_BASE_URL } from './config';

const PHOTON = 'https://photon.komoot.io/api';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

const shortName = (displayName) => displayName.split(',').slice(0, 2).join(',').trim();

// Both geocoders read the same OSM data, but Photon indexes POIs far better:
// "Grand Indonesia" finds the mall, where Nominatim returns a convention centre
// 30km away and ranks a hamlet above the city of Bandung. `near` ({lat,lon})
// biases both toward the user; for Nominatim the viewbox is a preference, not a
// bound (no `bounded=1`), so distant cities still resolve, and we take the
// highest `importance` rather than its first hit.
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

  // 2) Direct Photon.
  try {
    const at = near && Number.isFinite(near.lat) ? `&lat=${near.lat}&lon=${near.lon}` : '';
    const res = await fetch(`${PHOTON}?q=${encodeURIComponent(query)}&limit=5&lang=en${at}`);
    if (res.ok) {
      const f = (await res.json()).features?.[0];
      const p = f?.properties;
      const name = p && (p.name || p.street || p.city);
      if (name) {
        const [lon, lat] = f.geometry.coordinates;
        if (Number.isFinite(lat)) {
          return { name, label: [name, p.city || p.state, p.country].filter(Boolean).join(', '), lat, lon };
        }
      }
    }
  } catch {
    /* fall through to Nominatim */
  }

  // 3) Direct Nominatim.
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
