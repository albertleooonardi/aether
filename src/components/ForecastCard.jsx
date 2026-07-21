import React from 'react';
import { CalendarDays } from 'lucide-react';
import { getWeatherIcon } from '../utils/WeatherIcons';

const ForecastCard = ({ forecast }) => {
  const today = new Date().toDateString();

  return (
    <div className="rounded-3xl glass p-5">
      <div className="mb-4 flex items-center gap-2 border-b border-ink/10 pb-3">
        <CalendarDays size={16} className="text-ink/60" />
        <h3 className="text-xs font-semibold uppercase tracking-widest text-ink/70">
          {forecast.length}-Day Forecast
        </h3>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {forecast.map((day, idx) => {
          const isToday = day.date.toDateString() === today;
          return (
            <div
              key={idx}
              className={`flex flex-col items-center gap-2 rounded-2xl px-3 py-4 text-center transition-colors ${
                isToday ? 'glass border-ink/20' : 'glass-soft glass-hover'
              }`}
            >
              <span className="text-sm font-semibold text-ink">
                {isToday ? 'Today' : day.date.toLocaleDateString('en-US', { weekday: 'short' })}
              </span>
              <span className="text-[11px] text-ink/50">
                {day.date.toLocaleDateString('en-US', { day: '2-digit', month: '2-digit' })}
              </span>
              <span className="mt-1 text-2xl font-bold text-ink">{day.high}°</span>
              <span className="text-xs text-ink/55">{day.low}°</span>
              <div className="mt-1">{getWeatherIcon(day.weather, 30)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ForecastCard;
