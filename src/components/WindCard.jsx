import React from 'react';
import { Wind } from 'lucide-react';
import { Cell, Value } from './DetailCell';

// Dial, labels and hub are drawn in `ink` (via currentColor) so the compass
// inverts with the theme instead of vanishing into a light page.
const Compass = ({ degree = 0 }) => (
  <svg viewBox="0 0 100 100" className="h-12 w-12 shrink-0 text-ink sm:h-20 sm:w-20" aria-hidden="true">
    <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeOpacity="0.14" strokeWidth="1.5" />
    {Array.from({ length: 36 }).map((_, i) => (
      <line
        key={i}
        x1="50"
        y1="6"
        x2="50"
        y2={i % 9 === 0 ? 13 : 10}
        stroke="currentColor"
        strokeOpacity={i % 9 === 0 ? 0.5 : 0.18}
        strokeWidth="1"
        transform={`rotate(${i * 10} 50 50)`}
      />
    ))}
    {[
      ['N', 50, 23],
      ['E', 78, 51],
      ['S', 50, 79],
      ['W', 22, 51],
    ].map(([l, x, y]) => (
      <text key={l} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize="9" fill="currentColor" fillOpacity="0.45" fontWeight="600">
        {l}
      </text>
    ))}
    {/* The needle points the way the wind is blowing FROM. */}
    <g transform={`rotate(${degree} 50 50)`}>
      <line x1="50" y1="64" x2="50" y2="30" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <polygon points="50,24 45,34 55,34" fill="currentColor" />
    </g>
    <circle cx="50" cy="50" r="2.5" fill="currentColor" />
  </svg>
);

const WindCard = ({ weather }) => {
  const gust = Math.round(weather.gust ?? weather.wind);
  return (
    <Cell icon={Wind} label="Wind" note={`Gusts up to ${gust} km/h, from the ${weather.windDir}.`}>
      <div className="flex items-center justify-between gap-2 sm:gap-4">
        <Value value={Math.round(weather.wind)} unit="km/h" />
        <Compass degree={weather.windDegree ?? 0} />
      </div>
    </Cell>
  );
};

export default WindCard;
