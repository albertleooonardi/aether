import React from 'react';
import { Droplets, Eye, Gauge, Cloudy, CloudRain, Leaf, Sunrise } from 'lucide-react';
import { Cell, Value, Meter } from './DetailCell';
import UVCard from './UVCard';
import WindCard from './WindCard';
import { getAirQuality } from '../utils/ThemeUtils';

// "06:01 AM" -> minutes after midnight
const clockMinutes = (s) => {
  const m = /(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(s || '');
  if (!m) return null;
  let h = parseInt(m[1], 10) % 12;
  if (m[3] && m[3].toUpperCase() === 'PM') h += 12;
  if (!m[3]) h = parseInt(m[1], 10);
  return h * 60 + parseInt(m[2], 10);
};

// "YYYY-MM-DD HH:MM" -> minutes after midnight
const localMinutes = (localtime) => {
  const t = (localtime || '').split(' ')[1];
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

const SunCell = ({ weather }) => {
  const rise = clockMinutes(weather.sunrise);
  const set = clockMinutes(weather.sunset);
  const now = localMinutes(weather.localtime);
  const valid = rise !== null && set !== null && set > rise;
  const frac = valid && now !== null ? Math.max(0, Math.min(1, (now - rise) / (set - rise))) : 0;
  const up = valid && now !== null && now >= rise && now <= set;
  const R = 40;
  const arcLen = Math.PI * R;
  const sx = 50 - R * Math.cos(Math.PI * frac);
  const sy = 50 - R * Math.sin(Math.PI * frac);
  const len = valid ? set - rise : 0;
  const note = valid ? `${Math.floor(len / 60)}h ${len % 60}m of daylight today.` : null;

  return (
    <Cell icon={Sunrise} label="Sun" note={note}>
      <svg viewBox="0 0 100 56" className="h-14 w-full max-w-[13rem] text-ink sm:h-20" aria-hidden="true">
        <line x1="4" y1="50" x2="96" y2="50" stroke="currentColor" strokeOpacity="0.15" strokeWidth="0.75" />
        <path d={`M 10 50 A ${R} ${R} 0 0 1 90 50`} fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1" strokeDasharray="2 2.5" />
        {up && (
          <path
            d={`M 10 50 A ${R} ${R} 0 0 1 90 50`}
            fill="none"
            stroke="rgb(var(--butter))"
            strokeWidth="1.5"
            strokeDasharray={`${frac * arcLen} ${arcLen}`}
          />
        )}
        {up && <circle cx={sx} cy={sy} r="3.5" fill="rgb(var(--butter))" />}
      </svg>
      <div className="mt-2 flex justify-between gap-2 text-xs sm:mt-3 sm:gap-4 sm:text-sm">
        <div>
          <div className="text-ink/40 text-xs">Sunrise</div>
          <div className="tabular font-semibold text-ink">{weather.sunrise || '—'}</div>
        </div>
        <div className="text-right">
          <div className="text-ink/40 text-xs">Sunset</div>
          <div className="tabular font-semibold text-ink">{weather.sunset || '—'}</div>
        </div>
      </div>
    </Cell>
  );
};

const AirCell = ({ weather }) => {
  const aq = getAirQuality(weather.aqi);
  const idx = Number.isFinite(weather.aqi) ? weather.aqi : 0;
  return (
    <Cell
      icon={Leaf}
      label="Air quality"
      note={idx ? `US EPA index ${idx} of 6.` : 'No air-quality reading for this place.'}
    >
      <div className="flex items-center gap-2.5">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${aq.dot}`} />
        <span className="display text-2xl text-ink sm:text-3xl">{aq.label}</span>
      </div>
      <div className="mt-6 grid grid-cols-6 gap-1">
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <span key={n} className={`h-1 rounded-full ${n <= idx ? 'bg-ink/70' : 'bg-ink/[0.08]'}`} />
        ))}
      </div>
    </Cell>
  );
};

const pressureNote = (p) => {
  if (p < 1000) return 'Low pressure, often unsettled weather.';
  if (p > 1020) return 'High pressure, usually settled and dry.';
  return 'Normal pressure for sea level.';
};

/*
 * Every remaining reading in a 3×3 grid of cells divided by hairlines, each
 * with a value, a small visual, and a sentence on what it means.
 */
const DetailsGrid = ({ weather }) => (
  <div className="grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-hairline bg-hairline lg:grid-cols-3">
    <UVCard weather={weather} />
    <WindCard weather={weather} />
    <SunCell weather={weather} />

    <Cell icon={Droplets} label="Humidity" note={`The dew point is ${weather.dewpoint}° right now.`}>
      <Value value={weather.humidity} unit="%" />
      <Meter pct={weather.humidity} className="bg-lilac" />
    </Cell>

    <AirCell weather={weather} />

    <Cell icon={CloudRain} label="Precipitation" note={`${weather.chanceOfRain}% chance of rain today.`}>
      <Value value={weather.precipMm} unit="mm today" />
      <Meter pct={weather.chanceOfRain} className="bg-lilac" />
    </Cell>

    <Cell
      icon={Eye}
      label="Visibility"
      note={weather.visibility >= 10 ? 'Clear view to the horizon.' : 'Reduced visibility. Take care on the road.'}
    >
      <Value value={weather.visibility} unit="km" />
      <Meter pct={(Math.min(weather.visibility, 10) / 10) * 100} />
    </Cell>

    <Cell icon={Gauge} label="Pressure" note={pressureNote(weather.pressure)}>
      <Value value={Math.round(weather.pressure)} unit="hPa" />
      <Meter pct={((Math.min(Math.max(weather.pressure, 960), 1050) - 960) / 90) * 100} />
    </Cell>

    {/* Nine cells: on the 2-column phone grid the last one spans the row so no
        empty cell is left showing the hairline background. */}
    <Cell
      className="col-span-2 lg:col-span-1"
      icon={Cloudy}
      label="Cloud cover"
      note={weather.cloud > 75 ? 'Mostly overcast.' : weather.cloud > 35 ? 'Some cloud about.' : 'Mostly open sky.'}
    >
      <Value value={weather.cloud} unit="%" />
      <Meter pct={weather.cloud} />
    </Cell>
  </div>
);

export default DetailsGrid;
