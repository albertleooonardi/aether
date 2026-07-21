import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'aether.theme.v1';

const systemTheme = () =>
  window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';

const stored = () => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null; // private mode / storage disabled
  }
};

// data-theme drives every colour in the app (see the variables at the top of
// index.css). Applying it to <html> rather than a React root means the page
// background and the browser's own scrollbars/form controls flip too.
const apply = (theme) => {
  document.documentElement.setAttribute('data-theme', theme);
};

/*
 * Theme state: an explicit choice wins, otherwise the OS preference — and while
 * the user hasn't chosen, the app keeps following the OS if it changes (e.g. at
 * sunset on a schedule). Choosing pins it for good.
 */
export const useTheme = () => {
  const [theme, setTheme] = useState(() => stored() || systemTheme());

  useEffect(() => {
    apply(theme);
  }, [theme]);

  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = (e) => {
      if (!stored()) setTheme(e.matches ? 'light' : 'dark');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* not persisting is survivable — the theme still applies this session */
      }
      return next;
    });
  }, []);

  return { theme, toggle, isDark: theme === 'dark' };
};

// Set the theme before React mounts so the first paint is already correct —
// without this the app flashes dark before switching to light.
export const initTheme = () => apply(stored() || systemTheme());
