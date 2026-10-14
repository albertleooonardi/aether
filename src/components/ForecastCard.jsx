import React from 'react';
import { Umbrella } from 'lucide-react';
import { getWeatherIcon } from '../utils/WeatherIcons';

/*
 * The outlook as a ruled table. Each day's low-to-high bar is placed on the
 * shared scale of all days shown, so warmer and cooler days read at a glance.
 */
const ForecastCard = ({ forecast }) => {
  const today = new Date().toDateString();
  const lo = Math.min(...forecast.map((d) => d.low));
  const hi = Math.max(...forecast.map((d) => d.high));
  const span = Math.max(1, hi - lo);

  return (
    <div className="divide-y divide-ink/[0.08] border-y border-ink/[0.08]">
      {forecast.map((day, idx) => {
        const isToday = day.date.toDateString() === today;
        const left = ((day.low - lo) / span) * 100;
        const width = Math.max(4, ((day.high - day.low) / span) * 100);
        return (
          <div
            key={idx}
            className="grid grid-cols-[4.25rem_1.75rem_minmax(0,1fr)] items-center gap-3 py-4 sm:grid-cols-[8rem_minmax(0,1fr)_4.5rem_minmax(12rem,18rem)] sm:gap-6 sm:py-5"
          >
            <div>
              <div className="text-base font-semibold text-ink">
                {isToday ? (
                  'Today'
                ) : (
                  <>
                    <span className="sm:hidden">{day.date.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                    <span className="hidden sm:inline">{day.date.toLocaleDateString('en-US', { weekday: 'long' })}</span>
                  </>
                )}
              </div>
              <div className="text-xs text-ink/40">
                {day.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                {/* Phones have no rain column, so the chance rides under the date. */}
                <span className="tabular sm:hidden"> · {day.chanceOfRain}%</span>
              </div>
            </div>

            <div className="flex min-w-0 items-center gap-3">
              <span className="shrink-0">{getWeatherIcon(day.weather, 24)}</span>
              <span className="hidden truncate text-sm text-ink/65 sm:inline">{day.weather}</span>
            </div>

            <div className="hidden items-center gap-1.5 text-sm text-ink/50 sm:flex" title="Chance of rain">
              <Umbrella size={13} />
              <span className="tabular">{day.chanceOfRain}%</span>
            </div>

            <div className="tabular flex items-center gap-3 text-sm">
              <span className="w-8 text-right text-ink/45">{day.low}°</span>
              <span className="relative h-1.5 flex-1 rounded-full bg-ink/[0.08]">
                <span
                  className="absolute inset-y-0 rounded-full"
                  style={{
                    left: `${Math.min(left, 100 - width)}%`,
                    width: `${width}%`,
                    background: 'linear-gradient(90deg, rgb(var(--lilac)), rgb(var(--butter)))',
                  }}
                />
              </span>
              <span className="w-8 font-semibold text-ink">{day.high}°</span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ForecastCard;
