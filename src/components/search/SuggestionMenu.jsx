import React, { useEffect, useRef, useState } from 'react';
import { MapPin, Clock, LocateFixed, Building2, X } from 'lucide-react';
import { highlightParts } from '../../utils/Suggestions';

const ICONS = { locate: LocateFixed, recent: Clock, city: Building2, place: MapPin };

const Highlight = ({ text, query }) =>
  highlightParts(text, query).map((p, i) =>
    p.match ? (
      <span key={i} className="font-semibold text-ink">
        {p.text}
      </span>
    ) : (
      <span key={i}>{p.text}</span>
    )
  );

/*
 * Arrow keys move through the flattened list, Enter picks the active row.
 * Returns true when it handled the key, so the input can skip its own default
 * (e.g. submitting the form) for that keystroke.
 */
export const useMenuNav = (items, onPick) => {
  const [active, setActive] = useState(-1);
  const signature = items.map((i) => i.key).join('|');
  useEffect(() => setActive(-1), [signature]);

  const onKeyDown = (e) => {
    if (!items.length) return false;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % items.length);
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
      return true;
    }
    if (e.key === 'Enter' && active >= 0 && items[active]) {
      e.preventDefault();
      onPick(items[active]);
      return true;
    }
    return false;
  };

  return {
    activeKey: items[active]?.key ?? null,
    setActiveKey: (key) => setActive(items.findIndex((i) => i.key === key)),
    onKeyDown,
  };
};

const SuggestionMenu = ({ id, groups, query, activeKey, onPick, onHover, onRemove, loading, className = '' }) => {
  const listRef = useRef(null);

  // Keep the keyboard-active row in view inside a scrolling menu.
  useEffect(() => {
    if (!activeKey || !listRef.current) return;
    const sel = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(activeKey) : activeKey;
    const row = listRef.current.querySelector(`[data-key="${sel}"]`);
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [activeKey]);

  if (!groups.length && !loading) return null;

  return (
    <div ref={listRef} id={id} role="listbox" className={`thin-scroll overflow-y-auto ${className}`}>
      {groups.map((g) => (
        <div key={g.id} role="group" aria-label={g.title || 'Location'} className="py-0.5">
          {g.title && <div className="eyebrow px-3 pb-1 pt-2.5 !text-[10px] text-ink/40">{g.title}</div>}
          {g.items.map((item) => {
            const Icon = ICONS[item.type] || MapPin;
            const active = item.key === activeKey;
            return (
              <div
                key={item.key}
                data-key={item.key}
                role="option"
                aria-selected={active}
                // mousedown would blur the input before the click lands
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick(item)}
                onMouseEnter={() => onHover?.(item.key)}
                className={`group flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 transition-colors ${
                  active ? 'bg-ink/[0.08]' : 'hover:bg-ink/[0.05]'
                }`}
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                    item.type === 'locate' ? 'bg-accent text-accentFg' : 'bg-ink/[0.06] text-ink/55'
                  }`}
                >
                  <Icon size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink/80">
                    <Highlight text={item.title} query={query} />
                  </span>
                  {item.subtitle && <span className="block truncate text-xs text-ink/40">{item.subtitle}</span>}
                </span>
                {item.meta && <span className="tabular shrink-0 text-[11px] text-ink/40">{item.meta}</span>}
                {item.removable && onRemove && (
                  <button
                    type="button"
                    aria-label={`Remove ${item.title} from recent places`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(item);
                    }}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink/40 opacity-0 transition hover:bg-ink/10 hover:text-ink focus:opacity-100 group-hover:opacity-100"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ))}
      {/* Google's terms require attribution wherever its place results are shown. */}
      {groups.some((g) => g.items.some((i) => i.place && i.place.source === 'google')) && (
        <div className="px-3 pb-1 pt-2 text-right text-[10px] text-ink/35">Powered by Google</div>
      )}
      {loading && (
        <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-ink/40">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink/40" />
          Searching places…
        </div>
      )}
    </div>
  );
};

export default SuggestionMenu;
