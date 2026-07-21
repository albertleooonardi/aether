import React from 'react';
import { MapPin, Thermometer, CloudRain, Eye, Droplets } from 'lucide-react';
import { getWeatherAdvice } from '../utils/ThemeUtils';

const HeroStat = ({ icon: Icon, label, value, sub }) => (
  <div className="flex flex-col rounded-2xl glass-soft glass-hover p-4">
    <div className="flex items-center gap-2 text-ink/55">
      <Icon size={15} />
      <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
    </div>
    <div className="mt-2 text-2xl font-bold text-ink">{value}</div>
    {sub && <div className="mt-1 text-xs leading-snug text-ink/55">{sub}</div>}
  </div>
);

const WeatherCard = ({ weather, className = '' }) => {
  const advice = getWeatherAdvice(weather);
  const summary =
    weather.todayHigh !== null
      ? `Today, expect ${weather.description.toLowerCase()} with highs near ${weather.todayHigh}°C. ${advice}`
      : advice;

  const feelsSub =
    weather.feels_like > weather.temp
      ? 'Humidity is making it feel warmer'
      : weather.feels_like < weather.temp
      ? 'Wind is making it feel cooler'
      : 'Close to the actual temperature';

  return (
    <div className={`flex flex-col rounded-3xl glass p-4 md:p-5 ${className}`}>
      {/* Location pill */}
      <div className="flex items-center gap-2 rounded-2xl glass-soft px-4 py-3 text-sm text-ink/85">
        <MapPin size={16} className="shrink-0 text-ink/60" />
        <span className="truncate">
          {weather.city}
          {weather.country ? `, ${weather.country}` : ''}
        </span>
      </div>

      {/* Hero */}
      <div className="flex flex-1 flex-col items-center justify-center py-8 text-center">
        <div className="text-7xl font-bold leading-none text-ink text-glow md:text-8xl">
          {weather.temp}°
        </div>
        <div className="mt-3 text-2xl font-semibold capitalize text-ink md:text-3xl">
          {weather.description}
        </div>
        <p className="mt-4 max-w-sm text-sm leading-relaxed text-ink/70">{summary}</p>
      </div>

      {/* 2×2 stat grid */}
      <div className="grid grid-cols-2 gap-3">
        <HeroStat
          icon={Thermometer}
          label="Feels like"
          value={`${weather.feels_like}°`}
          sub={feelsSub}
        />
        <HeroStat
          icon={CloudRain}
          label="Precipitation"
          value={`${weather.precipMm} mm`}
          sub={`${weather.chanceOfRain}% chance of rain today`}
        />
        <HeroStat
          icon={Eye}
          label="Visibility"
          value={`${weather.visibility} km`}
          sub={weather.visibility >= 10 ? 'Crystal clear right now' : 'Reduced visibility'}
        />
        <HeroStat
          icon={Droplets}
          label="Humidity"
          value={`${weather.humidity}%`}
          sub={`The dew point is ${weather.dewpoint}° right now`}
        />
      </div>
    </div>
  );
};

export default WeatherCard;
