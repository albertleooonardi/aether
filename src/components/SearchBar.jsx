import React, { useEffect, useRef, useState } from 'react';
import { Search, Loader2, X, ArrowRight, LocateFixed, Clock, MapPin } from 'lucide-react';
import SuggestionMenu, { useMenuNav } from './search/SuggestionMenu';
import { CITIES } from '../data/cities';
import { buildLocalGroups, mergeRemote, flatItems, samePlace } from '../utils/Suggestions';
import { loadRecents, addRecent, removeRecent } from '../services/RecentPlaces';
import { createSuggestTypeahead, looksLikeUrl, placeSuggest } from '../services/GeoService';

/*
 * Underlined, editorial search field. Focus opens recommendations straight
 * away (your location, recent places, nearby cities); typing narrows them
 * instantly from local data, and geocoder results join underneath. Picking a
 * suggestion searches by coordinates, so "Central Park, Jakarta" can't be
 * re-resolved to a different Central Park.
 */
const SearchBar = ({ city, setCity, onSearch, onPickPlace, onLocate, loading, locating, near }) => {
  const typeahead = useRef(createSuggestTypeahead({ source: placeSuggest })).current;
  const wrap = useRef(null);
  const input = useRef(null);
  const [open, setOpen] = useState(false);
  const [remote, setRemote] = useState([]);
  const [searching, setSearching] = useState(false);
  const [recents, setRecents] = useState(loadRecents);

  useEffect(() => () => typeahead.cancel(), [typeahead]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrap.current && !wrap.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open]);

  const text = city || '';
  const local = buildLocalGroups({ query: text, recents, cities: CITIES, near, locate: true });
  const groups = text.trim().length >= 3 ? mergeRemote(local, remote, 'Places') : local;
  const items = flatItems(groups);

  const close = () => {
    setOpen(false);
    typeahead.cancel();
    setSearching(false);
  };

  const pick = (item) => {
    close();
    input.current?.blur();
    if (item.type === 'locate') return onLocate();
    setRecents(addRecent(item.place));
    setCity(item.place.name);
    onPickPlace(item.place);
  };

  const nav = useMenuNav(open ? items : [], pick);

  // Always-visible one-tap places under the bar: recent first, then nearby,
  // minus wherever the page is already showing.
  const quick = flatItems(buildLocalGroups({ recents, cities: CITIES, near, max: 6, recentMax: 3 }))
    .filter((i) => i.place && !samePlace(i.place, near))
    .slice(0, 6);

  const handleChange = (e) => {
    const value = e.target.value;
    setCity(value);
    setOpen(true);
    const t = value.trim();
    setSearching(t.length >= 3 && !looksLikeUrl(t));
    typeahead.run(value, near, (list) => {
      setRemote(list);
      setSearching(false);
    });
  };

  const submit = () => {
    if (!text.trim()) {
      setOpen(true);
      input.current?.focus();
      return;
    }
    close();
    onSearch();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      close();
      return;
    }
    if (open && nav.onKeyDown(e)) return;
    if (e.key === 'Enter') submit();
  };

  return (
    <div ref={wrap} className="relative w-full">
      <div className="panel-float flex h-16 items-center gap-2 rounded-full pl-5 pr-2 transition focus-within:ring-1 focus-within:ring-ink/25 md:h-[4.5rem] md:pl-7">
        <Search size={20} className="shrink-0 text-ink/40" />
        <input
          ref={input}
          type="text"
          value={text}
          onChange={handleChange}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={near ? 'Search another place' : 'Search a city, district or landmark'}
          aria-label="Search for a city"
          role="combobox"
          aria-expanded={open && items.length > 0}
          aria-controls="weather-search-menu"
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          className="w-full min-w-0 bg-transparent px-1 text-lg text-ink placeholder-ink/35 outline-none md:text-xl"
        />
        {text && !loading && (
          <button
            type="button"
            onClick={() => {
              setCity('');
              setRemote([]);
              input.current?.focus();
              setOpen(true);
            }}
            aria-label="Clear search"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink/40 transition hover:bg-ink/[0.07] hover:text-ink"
          >
            <X size={16} />
          </button>
        )}
        <button
          type="button"
          onClick={onLocate}
          disabled={locating}
          title="Use my current location"
          aria-label="Use my current location"
          className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink/55 transition hover:bg-ink/[0.07] hover:text-ink disabled:opacity-50 sm:flex"
        >
          {locating ? <Loader2 size={17} className="animate-spin" /> : <LocateFixed size={17} />}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={loading}
          aria-label="Search"
          className="btn-pill h-12 shrink-0 px-4 text-sm disabled:opacity-60 md:h-14 md:px-6 md:text-base"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <span className="hidden sm:inline">Search</span>}
          {!loading && <ArrowRight size={16} />}
        </button>
      </div>

      {open && (items.length > 0 || searching) && (
        <div className="panel-float absolute left-0 right-0 top-full z-30 mt-3 rounded-3xl p-2 animate-fade-in">
          <SuggestionMenu
            id="weather-search-menu"
            groups={groups}
            query={text}
            activeKey={nav.activeKey}
            onHover={nav.setActiveKey}
            onPick={pick}
            onRemove={(item) => setRecents(removeRecent(item.place))}
            loading={searching}
            className="max-h-[24rem]"
          />
        </div>
      )}

      {quick.length > 0 && (
        <div className="fade-x no-scrollbar mt-4 flex items-center gap-2 overflow-x-auto px-1 md:flex-wrap md:overflow-visible">
          {quick.map((item) => {
            const Icon = item.type === 'recent' ? Clock : MapPin;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => pick(item)}
                className="flex min-h-[2.25rem] shrink-0 items-center gap-1.5 rounded-full border border-hairline px-3.5 py-1.5 text-sm text-ink/65 transition hover:border-ink/30 hover:bg-ink/[0.05] hover:text-ink"
              >
                <Icon size={12} className="text-ink/35" />
                {item.title}
                {item.meta && <span className="tabular text-xs text-ink/35">{item.meta}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SearchBar;
