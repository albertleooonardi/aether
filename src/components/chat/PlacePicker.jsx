import React from 'react';
import { MapPin, Check } from 'lucide-react';
import { distanceKm } from '../../services/GeoService';

const away = (d) => (d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(d < 10 ? 1 : 0)} km`);

// "Which one did you mean?" — shown when a place name matches several spots, so a
// wrong guess costs a tap instead of a 27km detour to an estate agent's office.
const PlacePicker = ({ data, onPick }) => (
  <div className="mt-2 overflow-hidden rounded-2xl border border-white/10 bg-white/5">
    <div className="px-3 pb-1.5 pt-2.5 text-[11px] uppercase tracking-wide text-white/40">
      {data.chosen ? 'Destination' : `${data.candidates.length} matches for “${data.query}”`}
    </div>

    <div className="space-y-1 px-2 pb-2">
      {data.candidates.map((c, i) => {
        const picked = data.chosen && data.chosen.lat === c.lat && data.chosen.lon === c.lon;
        const dimmed = data.chosen && !picked;
        if (dimmed) return null;

        return (
          <button
            key={`${c.lat},${c.lon}`}
            type="button"
            disabled={!!data.chosen}
            onClick={() => onPick(c)}
            className={`flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left text-xs transition ${
              picked ? 'bg-sky-400/15 text-white' : 'text-white/75 hover:bg-white/10 hover:text-white'
            } ${data.chosen ? 'cursor-default' : ''}`}
          >
            {picked ? (
              <Check size={13} className="mt-0.5 shrink-0 text-sky-300" />
            ) : (
              <MapPin size={13} className="mt-0.5 shrink-0 text-white/35" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{c.name}</span>
              {c.label && c.label !== c.name && <span className="block truncate text-white/45">{c.label}</span>}
            </span>
            {data.origin && (
              <span className="shrink-0 pt-0.5 text-[10px] text-white/35">{away(distanceKm(data.origin, c))}</span>
            )}
            {i === 0 && !data.chosen && (
              <span className="shrink-0 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-white/50">
                best guess
              </span>
            )}
          </button>
        );
      })}
    </div>

    {!data.chosen && (
      <p className="px-3 pb-2.5 text-[11px] text-white/40">
        None of these? Paste a Google Maps link and I’ll use that instead.
      </p>
    )}
  </div>
);

export default PlacePicker;
