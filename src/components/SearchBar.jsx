import React from 'react';
import { Search, MapPin, Loader2 } from 'lucide-react';

const SearchBar = ({ city, setCity, onSearch, onLocate, loading, locating }) => (
  <div className="w-full">
    <div className="flex items-center gap-2 rounded-2xl glass p-2">
      <div className="flex flex-1 items-center gap-2 pl-2">
        <Search size={18} className="shrink-0 text-ink/50" />
        <input
          type="text"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSearch()}
          placeholder="Search for a city…"
          aria-label="Search for a city"
          className="w-full bg-transparent py-2.5 text-ink placeholder-ink/45 outline-none"
        />
      </div>

      <button
        onClick={onLocate}
        disabled={locating}
        title="Use my current location"
        aria-label="Use my current location"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink/80 transition-all hover:bg-ink/15 hover:text-ink disabled:opacity-50"
      >
        {locating ? <Loader2 size={19} className="animate-spin" /> : <MapPin size={19} />}
      </button>

      <button
        onClick={onSearch}
        disabled={loading}
        className="flex h-11 items-center gap-2 rounded-xl bg-accent/90 px-5 font-semibold text-accentFg transition-all hover:bg-accent active:scale-95 disabled:opacity-60"
      >
        {loading ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
        <span className="hidden sm:inline">{loading ? 'Loading' : 'Search'}</span>
      </button>
    </div>
  </div>
);

export default SearchBar;
