import React from 'react';

// Aether mark: the alchemical symbol for Air (upward triangle + bar), drawn as
// a monoline glyph in the current text colour so it follows the theme.
const Logo = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" className={`shrink-0 ${className}`}>
    <path d="M16 4.5 L28.5 26.5 L3.5 26.5 Z" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
    <line x1="10" y1="20" x2="22" y2="20" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

export default Logo;
