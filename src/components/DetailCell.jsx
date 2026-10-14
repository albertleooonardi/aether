import React from 'react';

// One cell of the hairline-ruled details grid.
export const Cell = ({ icon: Icon, label, note, children, className = '' }) => (
  <div className={`flex min-h-[10.5rem] min-w-0 flex-col bg-page p-4 sm:min-h-[13rem] sm:p-6 md:p-7 ${className}`}>
    <div className="flex items-center gap-2 text-ink/45">
      {Icon && <Icon size={14} />}
      <span className="eyebrow !text-[10px]">{label}</span>
    </div>
    <div className="mt-3 flex-1 sm:mt-5">{children}</div>
    {note && <p className="mt-3 text-[12px] leading-snug text-ink/50 sm:mt-5 sm:text-[13px] sm:leading-relaxed">{note}</p>}
  </div>
);

export const Value = ({ value, unit }) => (
  <div className="flex items-baseline gap-2">
    <span className="display tabular text-4xl text-ink sm:text-5xl">{value}</span>
    {unit && <span className="truncate text-xs font-medium text-ink/45 sm:text-sm">{unit}</span>}
  </div>
);

// Thin horizontal meter, 0–100.
export const Meter = ({ pct, className = 'bg-ink/70' }) => (
  <div className="mt-4 h-1 rounded-full bg-ink/[0.08] sm:mt-6">
    <div className={`h-full rounded-full ${className}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
  </div>
);
