/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      /*
       * Semantic palette. Every value is a CSS variable holding an "R G B"
       * triple, set per theme in index.css — so `text-ink/60` or `bg-panel/90`
       * keeps working with Tailwind's alpha syntax while flipping with the
       * theme. Components should reach for these, never a literal white/slate:
       *   ink        — primary foreground (white on dark, near-black on light)
       *   page       — app background
       *   surface    — card surface (.glass)
       *   panel      — floating overlays: chat sheet, map controls
       *   accent     — the inverted call-to-action button…
       *   accentFg   — …and the text that sits on it
       */
      colors: {
        ink: 'rgb(var(--ink) / <alpha-value>)',
        page: 'rgb(var(--page) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        panel: 'rgb(var(--panel) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        accentFg: 'rgb(var(--accent-fg) / <alpha-value>)',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(circle at center, var(--tw-gradient-stops))',
      },
      animation: {
        'fade-in-up': 'fadeInUp 0.6s cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-in': 'fadeIn 0.5s ease-out both',
        'float': 'float 7s ease-in-out infinite',
        'float-slow': 'float 11s ease-in-out infinite',
        'pulse-slow': 'pulseSoft 5s ease-in-out infinite',
        'spin-slow': 'spin 24s linear infinite',
        'shimmer': 'shimmer 2.2s linear infinite',
      },
      keyframes: {
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(26px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-12px)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '0.55', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.06)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-500px 0' },
          '100%': { backgroundPosition: '500px 0' },
        },
      },
    },
  },
  plugins: [],
}
