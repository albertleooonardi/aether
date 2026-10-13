import React from 'react';
import { Loader2 } from 'lucide-react';

// Shown under the search until the first reading lands.
const EmptyState = ({ locating, loading }) => (
  <div className="animate-fade-in-up">
    <p className="eyebrow flex items-center gap-2">
      <span className="text-lilac">Aether</span>
      <span className="text-ink/25">·</span>
      <span className="text-butter">{loading ? 'Reading the sky' : locating ? 'Finding you' : 'Live weather'}</span>
      {(loading || locating) && <Loader2 size={12} className="animate-spin text-ink/40" />}
    </p>
    <h1 className="display mt-6 text-[clamp(2.6rem,7vw,5.5rem)] text-ink">
      Weather, <span className="accent-serif text-[1.06em]">written</span>
      <span className="text-ink/40"> plainly.</span>
    </h1>
    <p className="mt-5 max-w-xl text-base text-ink/50">
      {locating ? 'Allow location access, or search any place above.' : 'Search any place above, or tap a suggestion.'}
    </p>
  </div>
);

export default EmptyState;
