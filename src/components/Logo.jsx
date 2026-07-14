import React from 'react';

// Aether mark — the alchemical symbol for Air (upward triangle + bar).
// Minimal monoline glyph in the app's palette.
const Logo = ({ size = 40 }) => (
  <span
    className="inline-flex shrink-0 items-center justify-center rounded-2xl"
    style={{ width: size, height: size, background: '#2E343E', border: '1px solid #434D5C' }}
  >
    <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M16 5 L28 26 L4 26 Z" stroke="#8C99AC" strokeWidth="2.2" strokeLinejoin="round" />
      <line x1="10.5" y1="20.5" x2="21.5" y2="20.5" stroke="#8C99AC" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  </span>
);

export default Logo;
