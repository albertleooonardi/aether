import React from 'react';
import { Clock } from 'lucide-react';
import { getWeatherIcon } from '../utils/WeatherIcons';
import { formatHour } from '../utils/TimeUtils';

const HourlyForecast = ({ hours }) => (
  <div className="rounded-3xl glass p-5">
    <div className="mb-4 flex items-center gap-2 border-b border-white/10 pb-3">
      <Clock size={16} className="text-white/60" />
      <h3 className="text-xs font-semibold uppercase tracking-widest text-white/70">
        Hourly forecast
      </h3>
    </div>

    <div className="no-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1">
      {hours.map((h, idx) => (
        <div
          key={idx}
          className={`flex min-w-[80px] flex-col items-center gap-2 rounded-2xl px-3 py-4 text-center transition-colors ${
            h.label === 'Now' ? 'glass border-white/20' : 'hover:bg-white/5'
          }`}
        >
          <span className="text-xs font-medium text-white/70">
            {h.label || formatHour(h.time)}
          </span>
          <span className="text-2xl font-bold text-white">{h.temp}°</span>
          <div>{getWeatherIcon(h.weather, 30, h.isDay)}</div>
        </div>
      ))}
    </div>
  </div>
);

export default HourlyForecast;
