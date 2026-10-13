import React from 'react';
import { getWeatherAdvice } from '../utils/ThemeUtils';
import { formatLocalTime } from '../utils/TimeUtils';
import { getWeatherIcon } from '../utils/WeatherIcons';

// Vertical thermometer: today's low at the bottom, high at the top, and a dot
// for where the temperature sits right now.
const RangeScale = ({ temp, low, high }) => {
  if (low === null || high === null) return null;
  const span = Math.max(1, high - low);
  const pct = Math.max(0, Math.min(100, ((temp - low) / span) * 100));
  return (
    <div className="flex min-h-[7.5rem] flex-col items-center py-1 text-[11px] font-medium text-ink/45" aria-label={`Today ${low}° to ${high}°`}>
      <span className="tabular">{high}°</span>
      <div
        className="relative my-2 w-[3px] flex-1 rounded-full"
        style={{ background: 'linear-gradient(180deg, rgb(var(--butter)), rgb(var(--lilac)))' }}
      >
        <span
          className="absolute left-1/2 h-3 w-3 -translate-x-1/2 translate-y-1/2 rounded-full bg-ink ring-4 ring-page"
          style={{ bottom: `${pct}%` }}
        />
      </div>
      <span className="tabular">{low}°</span>
    </div>
  );
};

const Fact = ({ label, value }) => (
  <div className="py-4 pr-4">
    <dt className="eyebrow !text-[10px] text-ink/40">{label}</dt>
    <dd className="display tabular mt-1.5 text-2xl text-ink">{value}</dd>
  </div>
);

/*
 * Current conditions, said briefly: a very large temperature beside today's
 * range, the sky in serif italic, one line of advice, and four readings.
 */
const WeatherCard = ({ weather }) => {
  const { time } = formatLocalTime(weather.localtime);
  const cond = (weather.description || '').trim();
  const place = [weather.city, weather.country].filter(Boolean).join(', ');

  return (
    <div className="animate-fade-in-up">
      <p className="eyebrow flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-lilac">Now</span>
        <span className="text-ink/25">·</span>
        <span className="text-butter">{place}</span>
        {time && <span className="ml-auto font-medium normal-case tracking-normal text-ink/40">{time} local</span>}
      </p>

      <div className="mt-6 grid items-end gap-x-16 gap-y-8 md:grid-cols-[auto_minmax(0,1fr)]">
        <div className="flex items-stretch gap-4">
          <span className="display tabular text-[clamp(6.5rem,17vw,12rem)] !leading-[0.8] text-ink">
            {weather.temp}°
          </span>
          <RangeScale temp={weather.temp} low={weather.todayLow} high={weather.todayHigh} />
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-3">
            {getWeatherIcon(cond, 30, weather.isDay)}
            <span className="accent-serif truncate text-[clamp(1.9rem,3.4vw,2.75rem)] leading-tight text-ink">
              {cond}
            </span>
          </div>
          <p className="mt-2 text-sm text-ink/50">{getWeatherAdvice(weather)}</p>

          <dl className="mt-6 grid grid-cols-2 border-t border-hairline sm:grid-cols-4">
            <Fact label="Feels" value={`${weather.feels_like}°`} />
            <Fact label="Rain" value={`${weather.chanceOfRain}%`} />
            <Fact label="Humidity" value={`${weather.humidity}%`} />
            <Fact label="Wind" value={`${Math.round(weather.wind)} km/h`} />
          </dl>
        </div>
      </div>
    </div>
  );
};

export default WeatherCard;
