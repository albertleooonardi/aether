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

/*
 * Vibrant, softly-shadowed icons that sit nicely on the card surface.
 *
 * Colours come from --wx-* variables (defined per theme in index.css) rather
 * than fixed Tailwind tints. The palette these icons want on a near-black page
 * is a set of pale 100/200 shades, and those same shades all but disappear on a
 * white card — so each variable carries a pale value for dark and a saturated
 * one for light, and the icon keeps its identity either way.
 */
export const getWeatherIcon = (weatherText, size = 48, isDay = 1) => {
  const text = (weatherText || '').toLowerCase();
  const night = isDay === 0;
  const icon = (Component, tint) => (
    <Component size={size} strokeWidth={1.5} className="drop-glow" style={{ color: `var(--wx-${tint})` }} />
  );

  if (text.includes('thunder')) return icon(CloudLightning, 'storm');
  if (text.includes('snow') || text.includes('blizzard') || text.includes('sleet') || text.includes('ice'))
    return icon(CloudSnow, 'snow');
  if (text.includes('drizzle') || text.includes('light rain')) return icon(CloudDrizzle, 'drizzle');
  if (text.includes('rain')) return icon(CloudRain, 'rain');
  if (text.includes('mist') || text.includes('fog') || text.includes('haze')) return icon(CloudFog, 'fog');
  // Partly cloudy gets a sun/moon combo.
  if (text.includes('partly') || text.includes('partial'))
    return night ? icon(CloudMoon, 'moon') : icon(CloudSun, 'sun');
  if (text.includes('cloud') || text.includes('overcast')) return icon(Cloud, 'cloud');
  if (text.includes('sunny') || text.includes('clear')) return night ? icon(Moon, 'moon') : icon(Sun, 'sun');

  return night ? icon(Moon, 'moon') : icon(Cloud, 'cloud');
};
