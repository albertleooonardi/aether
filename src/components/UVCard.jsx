import React from 'react';
import { Sun } from 'lucide-react';

const uvLabel = (uv) => {
  if (uv <= 2) return 'Low';
  if (uv <= 5) return 'Moderate';
  if (uv <= 7) return 'High';
  if (uv <= 10) return 'Very high';
  return 'Extreme';
};

const uvNote = (uv) => {
  if (uv <= 2) return 'No protection needed.';
  if (uv <= 5) return 'Use sun protection around midday.';
  if (uv <= 7) return 'Seek shade during midday hours.';
  if (uv <= 10) return 'Extra protection required — limit sun exposure.';
  return 'Take all precautions — avoid the sun.';
};

// Clamp a UV value (0–11+) to a marker position that stays inside the bar.
const toPct = (uv) => Math.max(3, Math.min(97, (Math.min(uv, 11) / 11) * 100));

const UVCard = ({ weather }) => {
  const current = weather.uv ?? 0;
  const max = weather.uvMax ?? current;
  const showPeak = max - current >= 1; // peak is meaningfully higher (e.g. at night)

  const label = uvLabel(current);
  const note = showPeak
    ? `Now ${label.toLowerCase()}. Peaks at ${Math.round(max)} (${uvLabel(max).toLowerCase()}) around midday.`
    : uvNote(current);

  return (
    <div className="flex flex-col rounded-3xl glass p-5">
      <div className="flex items-center justify-between text-ink/60">
        <div className="flex items-center gap-2">
          <Sun size={16} />
          <span className="text-xs font-semibold uppercase tracking-widest">UV Index</span>
        </div>
        {showPeak && (
          <span className="text-[11px] text-ink/50">Peak {Math.round(max)}</span>
        )}
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-4xl font-bold leading-none text-ink">{Math.round(current)}</span>
        <span className="text-sm font-medium text-ink/80">{label}</span>
      </div>

      {/* Scale with current marker (dot) + today's peak marker (tick) */}
      <div className="relative mt-4">
        <div
          className="h-2 rounded-full"
          style={{
            background:
              'linear-gradient(90deg,#4ade80,#a3e635,#facc15,#fb923c,#f87171,#c084fc)',
          }}
        />
        {showPeak && (
          <div
            className="absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink/50"
            style={{ left: `${toPct(max)}%` }}
            title={`Today's peak: ${Math.round(max)}`}
          />
        )}
        <div
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-ink/90 shadow"
          style={{ left: `${toPct(current)}%` }}
          title={`Now: ${Math.round(current)}`}
        />
      </div>

      <div className="mt-auto pt-4 text-xs text-ink/55">{note}</div>
    </div>
  );
};

export default UVCard;
