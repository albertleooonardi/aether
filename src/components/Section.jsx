import React from 'react';

// A numbered editorial section: "01  Next 12 hours", a hairline above, and an
// optional one-line aside on the right.
const Section = ({ index, title, aside, children }) => (
  <section className="border-t border-hairline py-12 md:py-16">
    <div className="mb-8 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 md:mb-10">
      <div className="flex items-baseline gap-4">
        <span className="eyebrow tabular text-lilac">{index}</span>
        <h2 className="display text-2xl !tracking-[-0.03em] text-ink md:text-[2rem]">{title}</h2>
      </div>
      {aside && <p className="text-sm text-ink/45">{aside}</p>}
    </div>
    {children}
  </section>
);

export default Section;
