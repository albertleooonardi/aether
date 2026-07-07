import React from 'react';
import { Sun, Moon, Sunrise, Sunset } from 'lucide-react';
import { formatLocalTime } from '../utils/TimeUtils';

const ClockBox = ({ weather, className = '' }) => {
  const { time, date } = formatLocalTime(weather.localtime);
  const isNight = weather.isDay === 0;

  return (
    <div className={`flex flex-col justify-between rounded-3xl glass p-5 ${className}`}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-white/60">
          Local time
        </span>
        <span className="flex items-center gap-1.5 rounded-full glass-soft px-2.5 py-1 text-[11px] text-white/80">
          {isNight ? <Moon size={12} className="text-indigo-200" /> : <Sun size={12} className="text-amber-200" />}
          {isNight ? 'Night' : 'Day'}
        </span>
      </div>

      <div className="my-3">
        <div className="text-4xl font-bold leading-none text-white text-glow">{time}</div>
        <div className="mt-1.5 text-xs text-white/60">{date}</div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex items-center gap-2 rounded-2xl glass-soft p-2.5">
          <Sunrise size={16} className="shrink-0 text-amber-200" />
          <div className="min-w-0">
            <div className="text-[10px] text-white/55">Sunrise</div>
            <div className="truncate text-xs font-semibold text-white">{weather.sunrise || '—'}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-2xl glass-soft p-2.5">
          <Sunset size={16} className="shrink-0 text-orange-200" />
          <div className="min-w-0">
            <div className="text-[10px] text-white/55">Sunset</div>
            <div className="truncate text-xs font-semibold text-white">{weather.sunset || '—'}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClockBox;
