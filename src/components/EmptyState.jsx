import React from 'react';
import { Compass, Search, MapPin } from 'lucide-react';

const EmptyState = ({ locating }) => (
  <div className="mt-10 flex flex-col items-center text-center animate-fade-in-up">
    <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full glass animate-pulse-slow">
      <Compass size={44} strokeWidth={1.5} className="text-ink/80 drop-glow" />
    </div>
    <h2 className="text-xl font-semibold text-ink">
      {locating ? 'Finding your location…' : 'Discover the weather anywhere'}
    </h2>
    <p className="mt-2 max-w-sm text-sm text-ink/60">
      {locating
        ? 'Please allow location access for local conditions.'
        : 'Search for a city or use your location to see live conditions and a 3-day forecast.'}
    </p>

    <div className="mt-6 flex flex-wrap justify-center gap-3 text-sm text-ink/70">
      <span className="flex items-center gap-2 rounded-full glass-soft px-4 py-2">
        <Search size={14} /> Type a city name
      </span>
      <span className="flex items-center gap-2 rounded-full glass-soft px-4 py-2">
        <MapPin size={14} /> Tap the pin for your area
      </span>
    </div>
  </div>
);

export default EmptyState;
