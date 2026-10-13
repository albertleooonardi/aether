import React from 'react';
import { getWeatherIcon } from '../utils/WeatherIcons';
import { formatHour } from '../utils/TimeUtils';

// Temperature labels sit in the top band; the curve uses the rest.
const TOP = 34; // % of the chart height reserved above the highest point
const BAND = 52; // % of the chart height the curve spans

/*
 * Next 12 hours as a temperature curve with the value labelled at each hour,
 * then the sky, the chance of rain as a small bar, and the hour.
 */
const HourlyForecast = ({ hours }) => {
  const temps = hours.map((h) => h.temp);
  const min = Math.min(...temps);
  const span = Math.max(1, Math.max(...temps) - min);
  const n = hours.length;
  const x = (i) => ((i + 0.5) / n) * 100;
  const y = (t) => TOP + (1 - (t - min) / span) * BAND;
  const points = hours.map((h, i) => `${x(i)},${y(h.temp)}`).join(' ');
  const area = `${x(0)},100 ${points} ${x(n - 1)},100`;

  return (
    <div className="no-scrollbar -mx-5 overflow-x-auto px-5 md:mx-0 md:px-0">
      <div className="min-w-[720px]">
        <div className="relative h-36">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
            <defs>
              <linearGradient id="hourly-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgb(var(--ink))" stopOpacity="0.10" />
                <stop offset="100%" stopColor="rgb(var(--ink))" stopOpacity="0" />
              </linearGradient>
            </defs>
            <polygon points={area} fill="url(#hourly-fill)" />
            <polyline
              points={points}
              fill="none"
              stroke="rgb(var(--ink) / 0.4)"
              strokeWidth="1.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {hours.map((h, i) => (
            <React.Fragment key={i}>
              <span
                className={`display tabular absolute -translate-x-1/2 text-xl ${i === 0 ? 'text-ink' : 'text-ink/75'}`}
                style={{ left: `${x(i)}%`, top: `calc(${y(h.temp)}% - 2.1rem)` }}
              >
                {h.temp}°
              </span>
              <span
                className={`absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ${
                  i === 0 ? 'bg-butter ring-4 ring-butter/20' : 'bg-ink/60'
                }`}
                style={{ left: `${x(i)}%`, top: `${y(h.temp)}%` }}
              />
            </React.Fragment>
          ))}
        </div>

        <div className="mt-4 grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
          {hours.map((h, i) => (
            <div key={i} className="flex flex-col items-center gap-3 text-center">
              {getWeatherIcon(h.weather, 22, h.isDay)}
              <div className="flex items-center gap-1.5" title={`${h.chanceOfRain}% chance of rain`}>
                <span className="relative h-5 w-1 overflow-hidden rounded-full bg-ink/[0.08]">
                  <span
                    className="absolute inset-x-0 bottom-0 rounded-full bg-lilac"
                    style={{ height: `${Math.max(0, Math.min(100, h.chanceOfRain))}%` }}
                  />
                </span>
                <span className="tabular text-[11px] text-ink/45">{h.chanceOfRain}%</span>
              </div>
              <span className={`eyebrow !text-[10px] ${i === 0 ? 'text-ink' : 'text-ink/40'}`}>
                {h.label || formatHour(h.time)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default HourlyForecast;
