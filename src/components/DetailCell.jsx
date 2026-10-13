import React from 'react';

// One cell of the hairline-ruled details grid.
export const Cell = ({ icon: Icon, label, note, children, className = '' }) => (
  <div className={`flex min-h-[13rem] flex-col bg-page p-6 md:p-7 ${className}`}>
    <div className="flex items-center gap-2 text-ink/45">
      {Icon && <Icon size={14} />}
      <span className="eyebrow !text-[10px]">{label}</span>
    </div>
    <div className="mt-5 flex-1">{children}</div>
    {note && <p className="mt-5 text-[13px] leading-relaxed text-ink/50">{note}</p>}
  </div>
);

export const Value = ({ value, unit }) => (
  <div className="flex items-baseline gap-2">
    <span className="display tabular text-5xl text-ink">{value}</span>
    {unit && <span className="text-sm font-medium text-ink/45">{unit}</span>}
  </div>
);

// Thin horizontal meter, 0–100.
export const Meter = ({ pct, className = 'bg-ink/70' }) => (
  <div className="mt-6 h-1 rounded-full bg-ink/[0.08]">
    <div className={`h-full rounded-full ${className}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
  </div>
);
