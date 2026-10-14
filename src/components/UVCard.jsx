import React from 'react';
import { Sun } from 'lucide-react';
import { Cell, Value } from './DetailCell';

export const uvLabel = (uv) => {
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
  if (uv <= 10) return 'Extra protection required. Limit sun exposure.';
  return 'Take all precautions and avoid the sun.';
};

// Clamp a UV value (0–11+) to a marker position that stays inside the bar.
const toPct = (uv) => Math.max(3, Math.min(97, (Math.min(uv, 11) / 11) * 100));

const UVCard = ({ weather }) => {
  const current = weather.uv ?? 0;
  const max = weather.uvMax ?? current;
  const showPeak = max - current >= 1; // peak is meaningfully higher (e.g. at night)
  const note = showPeak
    ? `Now ${uvLabel(current).toLowerCase()}. Peaks at ${Math.round(max)} around midday.`
    : uvNote(current);

  return (
    <Cell icon={Sun} label="UV index" note={note}>
      <Value value={Math.round(current)} unit={uvLabel(current)} />
      <div className="relative mt-4 sm:mt-6">
        <div
          className="h-1 rounded-full"
          style={{ background: 'linear-gradient(90deg,#4ade80,#a3e635,#facc15,#fb923c,#f87171,#c084fc)' }}
        />
        {showPeak && (
          <div
            className="absolute top-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-ink/60"
            style={{ left: `${toPct(max)}%` }}
            title={`Today's peak: ${Math.round(max)}`}
          />
        )}
        <div
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-page bg-ink"
          style={{ left: `${toPct(current)}%` }}
          title={`Now: ${Math.round(current)}`}
        />
      </div>
    </Cell>
  );
};

export default UVCard;
