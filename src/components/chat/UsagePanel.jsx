import React from 'react';

const fmt = (n) => (n ?? 0).toLocaleString('en-US');

const statusOf = (p, active) => {
  if (!p.hasKey) return { label: 'Off', color: '#6F7F96' };
  if (p.exhausted) return { label: 'Cooling', color: '#ef4444' };
  if (active) return { label: 'Active', color: '#22c55e' };
  return { label: 'Standby', color: '#8C99AC' };
};

const Row = ({ p, active }) => {
  const s = statusOf(p, active);
  const pct = p.budget ? Math.min(100, (p.tokens / p.budget) * 100) : 0;
  return (
    <div className="py-1.5">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
        <span className="flex-1 truncate text-white/85">
          {p.label} <span className="text-white/35">· {p.model}</span>
        </span>
        <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: `${s.color}22`, color: s.color }}>
          {s.label}
        </span>
      </div>
      <div className="mt-0.5 flex items-center justify-between pl-4 text-[11px] text-white/50">
        <span>{fmt(p.tokens)} tokens · {p.calls} calls</span>
        {p.budget ? <span>{fmt(p.budget)} budget</span> : null}
      </div>
      {p.budget ? (
        <div className="mt-1 ml-4 h-1 rounded-full bg-white/10">
          <div className="h-1 rounded-full" style={{ width: `${pct}%`, background: pct > 85 ? '#ef4444' : '#8C99AC' }} />
        </div>
      ) : null}
    </div>
  );
};

// Which provider would handle the next message.
const currentProvider = (usage) => {
  if (usage.gemini.available && usage.primary === 'gemini') return 'gemini';
  if (usage.groq.available && usage.primary === 'groq') return 'groq';
  if (usage.gemini.available) return 'gemini';
  if (usage.groq.available) return 'groq';
  return null;
};

const UsagePanel = ({ usage, active }) => {
  if (!usage) {
    return (
      <div className="border-b border-white/10 bg-white/5 px-4 py-3 text-xs text-white/50">
        Loading usage…
      </div>
    );
  }
  const current = active || currentProvider(usage);
  return (
    <div className="border-b border-white/10 bg-white/5 px-4 py-3">
      <div className="mb-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-white/60">
        <span>AI usage · today</span>
        <span className="text-white/45">{fmt(usage.totalTokens)} tokens</span>
      </div>
      <Row p={usage.gemini} active={current === 'gemini'} />
      <Row p={usage.groq} active={current === 'groq'} />
      <p className="mt-1.5 text-[10px] leading-snug text-white/40">
        Uses the lightest models and trims context for efficiency. Auto-switches to the backup when the primary is
        rate-limited or out of quota; usage resets daily.
      </p>
    </div>
  );
};

export default UsagePanel;
