// Classify the raw condition text into a small set of kinds.
export const getWeatherKind = (weather) => {
  if (!weather) return 'default';
  const t = weather.icon.toLowerCase();
  if (t.includes('thunder')) return 'storm';
  if (t.includes('snow') || t.includes('blizzard') || t.includes('sleet') || t.includes('ice')) return 'snow';
  if (t.includes('rain') || t.includes('drizzle')) return 'rain';
  if (t.includes('mist') || t.includes('fog') || t.includes('haze')) return 'fog';
  if (t.includes('cloud') || t.includes('overcast')) return 'cloud';
  if (t.includes('sunny') || t.includes('clear')) return 'clear';
  return 'default';
};

// Black theme: a near-black base with a subtle weather-tinted accent glow so the
// frosted-glass cards read as dark translucent panels.
export const getTheme = (weather) => {
  const gradient = 'from-neutral-950 via-black to-neutral-950';
  if (!weather) return { gradient, glow: 'rgba(59,130,246,0.14)' };

  const glowByKind = {
    clear: 'rgba(56,189,248,0.16)',
    cloud: 'rgba(148,163,184,0.13)',
    rain: 'rgba(96,165,250,0.16)',
    storm: 'rgba(129,140,248,0.18)',
    snow: 'rgba(224,242,254,0.15)',
    fog: 'rgba(203,213,225,0.13)',
    default: 'rgba(56,189,248,0.14)',
  };
  const kind = getWeatherKind(weather);
  return { gradient, glow: glowByKind[kind] || glowByKind.default };
};

// A short, human-friendly sentence describing what to expect / how to prepare.
export const getWeatherAdvice = (weather) => {
  if (!weather) return '';
  const t = weather.icon.toLowerCase();
  const feels = weather.feels_like;

  if (t.includes('thunder')) return 'Thunderstorms around — it is safest to stay indoors.';
  if (t.includes('snow') || t.includes('blizzard') || t.includes('sleet')) return 'Snowy out there — bundle up and tread carefully.';
  if (t.includes('rain') || t.includes('drizzle')) return 'Rain is on the way — keep an umbrella handy.';
  if (t.includes('fog') || t.includes('mist') || t.includes('haze')) return 'Low visibility — take extra care if you are driving.';
  if (feels <= 0) return 'Freezing cold — dress in warm, insulated layers.';
  if (feels <= 10) return 'Feeling chilly — a warm jacket is a good idea.';
  if (feels >= 32) return 'Hot outside — stay hydrated and seek some shade.';
  if (t.includes('cloud') || t.includes('overcast')) return 'Overcast but calm — a comfortable day overall.';
  if (t.includes('sunny') || t.includes('clear')) return 'Clear skies ahead — a lovely time to be outdoors.';
  return 'Pleasant conditions — enjoy the rest of your day.';
};

// Maps WeatherAPI's US EPA air-quality index (1–6) to a label and accent color.
export const getAirQuality = (index) => {
  switch (index) {
    case 1: return { label: 'Good', tone: 'text-emerald-200', dot: 'bg-emerald-300' };
    case 2: return { label: 'Moderate', tone: 'text-lime-200', dot: 'bg-lime-300' };
    case 3: return { label: 'Unhealthy for sensitive', tone: 'text-amber-200', dot: 'bg-amber-300' };
    case 4: return { label: 'Unhealthy', tone: 'text-orange-200', dot: 'bg-orange-300' };
    case 5: return { label: 'Very unhealthy', tone: 'text-rose-200', dot: 'bg-rose-300' };
    case 6: return { label: 'Hazardous', tone: 'text-fuchsia-200', dot: 'bg-fuchsia-300' };
    default: return { label: 'Unavailable', tone: 'text-ink/60', dot: 'bg-ink/40' };
  }
};
