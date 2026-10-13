// Current temperature + condition for many points in ONE request, for the city
// chips on the map. Open-Meteo takes comma-separated coordinate lists and needs
// no key, which keeps the WeatherAPI quota for the detail views. Best-effort:
// any failure just means fewer chips.
const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
const TTL_MS = 10 * 60 * 1000;

const cache = new Map(); // "lat,lon" -> { at, temp, code, isDay, text }

// WMO weather codes as plain words. getWeatherIcon reads condition text, so the
// words are chosen to hit the same keywords WeatherAPI uses.
export const wmoText = (code) => {
  if (code === 0) return 'Clear';
  if (code === 1) return 'Mainly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code === 61 || code === 80) return 'Light rain';
  if (code === 63 || code === 81 || code === 66) return 'Rain';
  if (code === 65 || code === 82 || code === 67) return 'Heavy rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'Snow';
  if (code >= 95) return 'Thunderstorm';
  return 'Cloudy';
};

const keyOf = (p) => `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;

export const fetchCityConditions = async (places, signal) => {
  const now = Date.now();
  const missing = places.filter((p) => {
    const hit = cache.get(keyOf(p));
    return !hit || now - hit.at > TTL_MS;
  });

  if (missing.length) {
    const lat = missing.map((p) => p.lat.toFixed(4)).join(',');
    const lon = missing.map((p) => p.lon.toFixed(4)).join(',');
    try {
      const res = await fetch(
        `${OPEN_METEO}?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,is_day&timezone=auto`,
        { signal }
      );
      if (res.ok) {
        const body = await res.json();
        const rows = Array.isArray(body) ? body : [body];
        rows.forEach((row, i) => {
          const cur = row && row.current;
          const p = missing[i];
          if (!p || !cur || !Number.isFinite(cur.temperature_2m)) return;
          cache.set(keyOf(p), {
            at: now,
            temp: Math.round(cur.temperature_2m),
            code: cur.weather_code,
            isDay: cur.is_day,
            text: wmoText(cur.weather_code),
          });
        });
      }
    } catch {
      /* aborted or offline — fall through to whatever is cached */
    }
  }

  return places.map((p) => ({ ...p, wx: cache.get(keyOf(p)) || null })).filter((p) => p.wx);
};
