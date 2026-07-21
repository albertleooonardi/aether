import React from 'react';
import { Wind } from 'lucide-react';

// Dial, labels and hub are drawn in `ink` (via currentColor) so the compass
// inverts with the theme instead of vanishing into a light card.
const Compass = ({ degree = 0 }) => (
  <svg viewBox="0 0 100 100" className="h-24 w-24 shrink-0 text-ink">
    <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeOpacity="0.14" strokeWidth="2" />
    <circle cx="50" cy="50" r="38" fill="none" stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" />
    {[
      ['N', 50, 16],
      ['E', 86, 54],
      ['S', 50, 90],
      ['W', 14, 54],
    ].map(([l, x, y]) => (
      <text
        key={l}
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="10"
        fill="currentColor"
        fillOpacity="0.5"
        fontWeight="600"
      >
        {l}
      </text>
    ))}
    {/* Needle points in the wind's compass direction */}
    <g transform={`rotate(${degree} 50 50)`}>
      <polygon points="50,24 44,52 56,52" fill="#f87171" />
      <polygon points="50,76 44,52 56,52" fill="currentColor" fillOpacity="0.55" />
    </g>
    <circle cx="50" cy="52" r="3" fill="currentColor" />
  </svg>
);

const WindMetric = ({ value, unit, label }) => (
  <div className="flex items-baseline gap-1.5">
    <span className="text-2xl font-bold text-ink">{value}</span>
    <span className="text-xs text-ink/55">{unit}</span>
    <span className="ml-1 text-sm text-ink/70">{label}</span>
  </div>
);

const WindCard = ({ weather }) => (
  <div className="flex items-center justify-between gap-4 rounded-3xl glass p-5">
    <div className="flex flex-col">
      <div className="flex items-center gap-2 text-ink/60">
        <Wind size={16} />
        <span className="text-xs font-semibold uppercase tracking-widest">Wind</span>
      </div>

      <div className="mt-4 space-y-2">
        <WindMetric value={Math.round(weather.wind)} unit="km/h" label="Wind" />
        <div className="h-px w-32 bg-ink/10" />
        <WindMetric value={Math.round(weather.gust ?? weather.wind)} unit="km/h" label="Gusts" />
      </div>

      <div className="mt-3 text-xs text-ink/50">From the {weather.windDir}</div>
    </div>

    <Compass degree={weather.windDegree ?? 0} />
  </div>
);

export default WindCard;
