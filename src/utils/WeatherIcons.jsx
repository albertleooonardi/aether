import React from 'react';
import {
  Sun,
  Moon,
  Cloud,
  CloudRain,
  CloudSnow,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudSun,
  CloudMoon,
} from 'lucide-react';

// Vibrant, softly-shadowed icons that sit nicely on frosted glass.
export const getWeatherIcon = (weatherText, size = 48, isDay = 1) => {
  const props = { size, strokeWidth: 1.5, className: 'drop-glow' };
  const text = (weatherText || '').toLowerCase();
  const night = isDay === 0;

  // Thunderstorm
  if (text.includes('thunder')) {
    return <CloudLightning {...props} className={`${props.className} text-violet-200`} />;
  }
  // Snow
  if (text.includes('snow') || text.includes('blizzard') || text.includes('sleet') || text.includes('ice')) {
    return <CloudSnow {...props} className={`${props.className} text-sky-100`} />;
  }
  // Drizzle / light rain
  if (text.includes('drizzle') || text.includes('light rain')) {
    return <CloudDrizzle {...props} className={`${props.className} text-sky-200`} />;
  }
  // Rain
  if (text.includes('rain')) {
    return <CloudRain {...props} className={`${props.className} text-blue-200`} />;
  }
  // Fog / mist / haze
  if (text.includes('mist') || text.includes('fog') || text.includes('haze')) {
    return <CloudFog {...props} className={`${props.className} text-slate-200`} />;
  }
  // Cloudy / overcast (partly cloudy gets a sun/moon combo)
  if (text.includes('partly') || text.includes('partial')) {
    return night
      ? <CloudMoon {...props} className={`${props.className} text-indigo-100`} />
      : <CloudSun {...props} className={`${props.className} text-amber-100`} />;
  }
  if (text.includes('cloud') || text.includes('overcast')) {
    return <Cloud {...props} className={`${props.className} text-slate-100`} />;
  }
  // Clear / sunny
  if (text.includes('sunny') || text.includes('clear')) {
    return night
      ? <Moon {...props} className={`${props.className} text-indigo-100`} />
      : <Sun {...props} className={`${props.className} text-amber-200`} />;
  }

  // Default
  return night
    ? <Moon {...props} className={`${props.className} text-indigo-100`} />
    : <Cloud {...props} className={`${props.className} text-slate-100`} />;
};
