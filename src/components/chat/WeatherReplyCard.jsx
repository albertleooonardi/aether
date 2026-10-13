import React from 'react';
import { getWeatherIcon } from '../../utils/WeatherIcons';

// Compact weather card inside a chat reply. Four equal columns of stacked
// value + label always fit the narrow chat panel, whatever the screen size.
const WeatherReplyCard = ({ data }) => {
  const stats = [
    { value: `${data.feelsLike}°`, label: 'Feels' },
    { value: `${data.chanceOfRain}%`, label: 'Rain' },
    { value: `${data.humidity}%`, label: 'Humidity' },
    { value: `${Math.round(data.wind)}`, label: 'km/h' },
  ];

  return (
    <div className="mt-2.5 overflow-hidden rounded-2xl border border-ink/[0.1]">
      <div className="flex items-center gap-3 px-3.5 pb-3 pt-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-ink">{data.name}</div>
          <div className="truncate text-[11px] text-ink/45">{data.country}</div>
        </div>
        <div className="shrink-0">{getWeatherIcon(data.icon, 28, data.isDay)}</div>
        <div className="shrink-0 text-right">
          <div className="display tabular text-3xl text-ink">{data.temp}°</div>
          <div className="tabular text-[10px] text-ink/45">
            H {data.high}° · L {data.low}°
          </div>
        </div>
      </div>
      <div className="truncate px-3.5 pb-2.5 font-serif text-[15px] italic text-ink/80">{data.condition}</div>
      <div className="grid grid-cols-4 divide-x divide-ink/[0.08] border-t border-ink/[0.08]">
        {stats.map((s) => (
          <div key={s.label} className="min-w-0 px-1 py-2 text-center">
            <div className="tabular truncate text-[13px] font-semibold text-ink">{s.value}</div>
            <div className="truncate text-[10px] text-ink/45">{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default WeatherReplyCard;
