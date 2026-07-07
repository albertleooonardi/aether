import React from 'react';
import { Route as RouteIcon, Trash2, Footprints, Bike, Navigation, MessageCircle } from 'lucide-react';

const SEG_COLORS = {
  clear: 'bg-emerald-400/80',
  light_rain: 'bg-sky-400/80',
  rain: 'bg-blue-500/90',
  wind: 'bg-slate-400/80',
};

const ActivityIcon = ({ type, ...props }) =>
  type === 'bike' ? <Bike {...props} /> : <Footprints {...props} />;

const MiniTimeline = ({ timeline }) => {
  const total = timeline.totalMin || 1;
  return (
    <div className="mt-3 flex h-2.5 overflow-hidden rounded-full">
      {timeline.segments.map((s) => (
        <div
          key={s.index}
          className={`${SEG_COLORS[s.condition]} h-full`}
          style={{ width: `${((s.endEta - s.startEta) / total) * 100}%` }}
        />
      ))}
    </div>
  );
};

const RoutesSection = ({ routes, routeForecast, onDelete }) => (
  <div className="rounded-3xl glass p-5">
    <div className="mb-4 flex items-center gap-2 border-b border-white/10 pb-3">
      <RouteIcon size={16} className="text-white/60" />
      <h3 className="text-xs font-semibold uppercase tracking-widest text-white/70">
        Routes
      </h3>
    </div>

    {routes.length === 0 ? (
      <div className="flex items-start gap-2.5 rounded-2xl glass-soft p-4 text-sm text-white/60">
        <MessageCircle size={16} className="mt-0.5 shrink-0 text-white/50" />
        <span>
          No routes yet. Open the chat and say{' '}
          <span className="text-white/85">“save a run route here”</span> to create one, then{' '}
          <span className="text-white/85">“forecast my run”</span> for the weather along it.
        </span>
      </div>
    ) : (
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {routes.map((r) => (
          <div key={r.id} className="flex items-center gap-3 rounded-2xl glass-soft p-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10">
              <ActivityIcon type={r.activityType} size={17} className="text-white/80" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-white">{r.name}</div>
              <div className="text-xs text-white/55">
                {r.distanceKm.toFixed(1)} km · {r.avgPaceMinPerKm} min/km
              </div>
            </div>
            <button
              onClick={() => onDelete(r.id)}
              aria-label={`Delete ${r.name}`}
              className="shrink-0 rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-rose-200"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    )}

    {/* Latest chat-driven forecast */}
    {routeForecast && (
      <div className="mt-4 rounded-2xl glass-soft p-4">
        <div className="flex items-center gap-2 text-white">
          <Navigation size={15} className="text-sky-200" />
          <span className="text-sm font-semibold">{routeForecast.routeName}</span>
        </div>
        <p className="mt-1 text-sm text-white/80">{routeForecast.summary}</p>
        <MiniTimeline timeline={routeForecast.timeline} />
      </div>
    )}
  </div>
);

export default RoutesSection;
