import React from 'react';
import { Droplets, Wind, Gauge, Eye, Sun, Thermometer, Cloudy, Leaf } from 'lucide-react';
import { getAirQuality } from '../utils/ThemeUtils';

const uvLabel = (uv) => {
  if (uv <= 2) return 'Low';
  if (uv <= 5) return 'Moderate';
  if (uv <= 7) return 'High';
  if (uv <= 10) return 'Very high';
  return 'Extreme';
};

// Compact horizontal tile: icon chip on the left, label + value stacked tight.
const StatBox = ({ icon: Icon, label, value, unit, hint }) => (
  <div
    title={hint}
    className="flex items-center gap-2.5 rounded-2xl glass glass-hover p-3"
  >
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink/10">
      <Icon size={15} className="text-ink/75" />
    </span>
    <div className="min-w-0">
      <div className="truncate text-[10px] font-medium uppercase tracking-wide text-ink/55">
        {label}
      </div>
      <div className="flex items-baseline gap-1 text-ink">
        <span className="text-lg font-semibold leading-tight">{value}</span>
        {unit && <span className="text-[11px] text-ink/55">{unit}</span>}
      </div>
    </div>
  </div>
);

const WeatherStats = ({ weather }) => {
  const aq = getAirQuality(weather.aqi);

  const stats = [
    { icon: Thermometer, label: 'Feels like', value: `${weather.feels_like}°`, hint: `Actual ${weather.temp}°` },
    { icon: Droplets, label: 'Humidity', value: `${weather.humidity}`, unit: '%', hint: weather.humidity > 70 ? 'Humid' : 'Comfortable' },
    { icon: Wind, label: 'Wind', value: `${Math.round(weather.wind)}`, unit: 'km/h', hint: `From ${weather.windDir}` },
    { icon: Sun, label: 'UV index', value: `${weather.uv}`, hint: uvLabel(weather.uv) },
    { icon: Eye, label: 'Visibility', value: `${weather.visibility}`, unit: 'km', hint: weather.visibility >= 10 ? 'Crystal clear' : 'Reduced' },
    { icon: Gauge, label: 'Pressure', value: `${weather.pressure}`, unit: 'hPa', hint: 'Sea level' },
    { icon: Cloudy, label: 'Cloud cover', value: `${weather.cloud}`, unit: '%', hint: weather.cloud > 60 ? 'Mostly cloudy' : 'Fairly clear' },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
      {stats.map((s, idx) => (
        <StatBox key={idx} {...s} />
      ))}

      {/* Air quality tile */}
      <div className="flex items-center gap-2.5 rounded-2xl glass glass-hover p-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink/10">
          <Leaf size={15} className="text-ink/75" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[10px] font-medium uppercase tracking-wide text-ink/55">
            Air quality
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`h-2 w-2 shrink-0 rounded-full ${aq.dot}`} />
            <span className={`truncate text-sm font-semibold ${aq.tone}`}>{aq.label}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WeatherStats;
