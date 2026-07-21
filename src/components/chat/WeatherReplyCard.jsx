import React from 'react';
import { Droplets, Wind, Thermometer, Umbrella } from 'lucide-react';
import { getWeatherIcon } from '../../utils/WeatherIcons';

// Compact, rich weather card rendered inline in a chat reply.
const WeatherReplyCard = ({ data }) => {
  const chips = [
    { icon: Thermometer, label: `Feels ${data.feelsLike}°` },
    { icon: Umbrella, label: `${data.chanceOfRain}% rain` },
    { icon: Droplets, label: `${data.humidity}%` },
    { icon: Wind, label: `${Math.round(data.wind)} km/h` },
  ];

  return (
    <div className="mt-2 overflow-hidden rounded-2xl border border-ink/10 bg-ink/5">
      <div className="flex items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink">{data.name}</div>
          <div className="truncate text-xs text-ink/55">{data.country}</div>
          <div className="mt-2 flex items-end gap-2">
            <span className="text-4xl font-bold leading-none text-ink">{data.temp}°</span>
            <span className="mb-0.5 text-sm capitalize text-ink/75">{data.condition}</span>
          </div>
          <div className="mt-1 text-xs text-ink/50">
            H {data.high}° · L {data.low}°
          </div>
        </div>
        <div className="shrink-0">{getWeatherIcon(data.icon, 56, data.isDay)}</div>
      </div>
      <div className="grid grid-cols-2 gap-px bg-ink/10 sm:grid-cols-4">
        {chips.map((c, i) => (
          <div key={i} className="flex items-center gap-1.5 bg-panel/60 px-3 py-2 text-xs text-ink/70">
            <c.icon size={13} className="text-ink/50" />
            {c.label}
          </div>
        ))}
      </div>
    </div>
  );
};

export default WeatherReplyCard;
