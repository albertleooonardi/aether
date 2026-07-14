import React from 'react';

// Minimal markdown-ish renderer: **bold**, `•`/`-` bullets, and line breaks.
// Enough to give assistant replies a clean, GPT/Claude-style structure.
const renderInline = (line, key) => {
  const parts = line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <React.Fragment key={key}>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') ? (
          <strong key={i} className="font-semibold text-white">
            {p.slice(2, -2)}
          </strong>
        ) : (
          <React.Fragment key={i}>{p}</React.Fragment>
        )
      )}
    </React.Fragment>
  );
};

const RichText = ({ text }) => {
  const lines = text.split('\n');
  return (
    <div className="space-y-1.5 text-sm leading-relaxed">
      {lines.map((line, i) => {
        const bullet = line.match(/^\s*[•\-*]\s+(.*)$/);
        if (bullet) {
          return (
            <div key={i} className="flex gap-2">
              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-white/50" />
              <span>{renderInline(bullet[1], i)}</span>
            </div>
          );
        }
        if (!line.trim()) return <div key={i} className="h-1" />;
        return <p key={i}>{renderInline(line, i)}</p>;
      })}
    </div>
  );
};

export default RichText;
