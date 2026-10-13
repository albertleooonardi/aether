import React, { memo, useMemo } from 'react';

/*
 * Ambient weather backdrop behind the page: sun, clouds, rain, storm, fog,
 * snow or a starry night, picked from the current condition.
 *
 * Two rules keep it calm:
 *  - Particles come from a seeded generator inside useMemo, so a re-render
 *    (typing in the search box, a theme flip) never moves or restarts them.
 *  - Every particle passes duration AND delay in the `animation` shorthand.
 *    Negative delays start each one mid-cycle, so the sky is already full on
 *    the first frame instead of filling in from the top.
 */

// Small deterministic PRNG (Park–Miller) so the same scene draws the same sky.
const seeded = (seed) => {
  let s = seed % 2147483647 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
};

const range = (r, min, max) => min + r() * (max - min);

// Condition text + day/night -> one of a few scenes.
export const sceneOf = (weather) => {
  if (!weather) return null;
  const t = `${weather.icon || ''} ${weather.description || ''}`.toLowerCase();
  const night = weather.isDay === 0;
  if (t.includes('thunder')) return 'storm';
  if (/snow|blizzard|sleet|ice pellets/.test(t)) return 'snow';
  if (/rain|drizzle|shower/.test(t)) {
    if (/heavy|torrential/.test(t)) return 'rain-heavy';
    if (/light|patchy|drizzle/.test(t)) return 'rain-light';
    return 'rain';
  }
  if (/fog|mist|haze|smoke/.test(t)) return 'fog';
  if (/partly|partial/.test(t)) return night ? 'night-cloud' : 'partly';
  if (/overcast|cloud/.test(t)) return night ? 'night-cloud' : 'cloud';
  if (/sunny|clear/.test(t)) return night ? 'night' : 'sun';
  return night ? 'night' : null;
};

const RAIN = {
  'rain-light': { count: 45, speed: [1.1, 1.6], opacity: 0.35 },
  rain: { count: 80, speed: [0.8, 1.15], opacity: 0.45 },
  'rain-heavy': { count: 130, speed: [0.55, 0.85], opacity: 0.55 },
};

const Rain = ({ level }) => {
  const cfg = RAIN[level] || RAIN.rain;
  const drops = useMemo(() => {
    const r = seeded(11 + cfg.count);
    return Array.from({ length: cfg.count }, () => {
      const dur = range(r, ...cfg.speed);
      return { left: range(r, -5, 105), len: range(r, 14, 30), dur, delay: -r() * dur, o: range(r, 0.4, 1) };
    });
  }, [cfg]);
  return (
    <div className="wx-moving absolute inset-0" style={{ opacity: cfg.opacity }}>
      {drops.map((d, i) => (
        <span
          key={i}
          className="absolute top-0 w-px rounded-full"
          style={{
            left: `${d.left}%`,
            height: d.len,
            opacity: d.o,
            background: 'linear-gradient(to bottom, rgb(var(--ink) / 0), rgb(var(--ink) / 0.85))',
            transform: 'rotate(12deg)',
            animation: `wxRain ${d.dur}s linear ${d.delay}s infinite`,
            willChange: 'transform',
          }}
        />
      ))}
    </div>
  );
};

const Snow = () => {
  const flakes = useMemo(() => {
    const r = seeded(7);
    return Array.from({ length: 60 }, () => {
      const dur = range(r, 9, 16);
      return { left: range(r, 0, 100), size: range(r, 2, 5), dur, delay: -r() * dur, drift: range(r, -40, 40), o: range(r, 0.4, 0.9) };
    });
  }, []);
  return (
    <div className="wx-moving absolute inset-0">
      {flakes.map((f, i) => (
        <span
          key={i}
          className="absolute top-0 rounded-full bg-ink"
          style={{
            left: `${f.left}%`,
            width: f.size,
            height: f.size,
            opacity: f.o,
            '--wx-drift': `${f.drift}px`,
            animation: `wxSnow ${f.dur}s linear ${f.delay}s infinite`,
            willChange: 'transform',
          }}
        />
      ))}
    </div>
  );
};

// Soft blurred cloud banks drifting left to right, slowly.
const Clouds = ({ count = 6, opacity = 0.16 }) => {
  const clouds = useMemo(() => {
    const r = seeded(29 + count);
    return Array.from({ length: count }, () => {
      const dur = range(r, 90, 160);
      return { top: range(r, -6, 45), w: range(r, 28, 48), dur, delay: -r() * dur, o: range(r, 0.6, 1) };
    });
  }, [count]);
  return (
    <div className="absolute inset-0" style={{ opacity }}>
      {clouds.map((c, i) => (
        <span
          key={i}
          className="absolute left-0 rounded-full blur-3xl"
          style={{
            top: `${c.top}%`,
            width: `${c.w}vw`,
            height: `${c.w * 0.32}vw`,
            opacity: c.o,
            background: 'rgb(var(--hairline))',
            animation: `wxCloud ${c.dur}s linear ${c.delay}s infinite`,
            willChange: 'transform',
          }}
        />
      ))}
    </div>
  );
};

const Stars = ({ count = 80 }) => {
  const stars = useMemo(() => {
    const r = seeded(3);
    return Array.from({ length: count }, () => {
      const dur = range(r, 2.5, 6);
      return { left: range(r, 0, 100), top: range(r, 0, 70), size: r() > 0.85 ? 2 : 1, dur, delay: -r() * dur };
    });
  }, [count]);
  return (
    <div className="absolute inset-0">
      {stars.map((s, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-ink"
          style={{
            left: `${s.left}%`,
            top: `${s.top}%`,
            width: s.size,
            height: s.size,
            opacity: 0.5,
            animation: `wxTwinkle ${s.dur}s ease-in-out ${s.delay}s infinite`,
          }}
        />
      ))}
    </div>
  );
};

// Slow-turning rays and a breathing glow in the top-right corner, plus a few
// warm motes rising through the light. Tinted with the butter accent.
const Sun = ({ strength = 1 }) => {
  const motes = useMemo(() => {
    const r = seeded(17);
    return Array.from({ length: 22 }, () => {
      const dur = range(r, 9, 16);
      return { left: range(r, 45, 100), top: range(r, 20, 95), size: range(r, 1.5, 3.5), dur, delay: -r() * dur, drift: range(r, -30, 30) };
    });
  }, []);
  return (
    <div className="absolute inset-0" style={{ opacity: strength }}>
      <div
        className="absolute -right-[22vmax] -top-[22vmax] h-[60vmax] w-[60vmax] rounded-full"
        style={{
          background: 'radial-gradient(circle, rgb(var(--butter) / 0.16) 0%, rgb(var(--butter) / 0.05) 35%, transparent 65%)',
          animation: 'wxBreathe 9s ease-in-out 0s infinite',
        }}
      />
      <div
        className="absolute -right-[45vmax] -top-[45vmax] h-[110vmax] w-[110vmax]"
        style={{
          background:
            'repeating-conic-gradient(from 0deg, rgb(var(--butter) / 0.06) 0deg 4deg, transparent 4deg 15deg)',
          WebkitMaskImage: 'radial-gradient(circle, #000 0%, rgba(0,0,0,.5) 30%, transparent 62%)',
          maskImage: 'radial-gradient(circle, #000 0%, rgba(0,0,0,.5) 30%, transparent 62%)',
          animation: 'wxSpin 160s linear 0s infinite',
        }}
      />
      <div className="wx-moving absolute inset-0">
        {motes.map((m, i) => (
          <span
            key={i}
            className="absolute rounded-full"
            style={{
              left: `${m.left}%`,
              top: `${m.top}%`,
              width: m.size,
              height: m.size,
              background: 'rgb(var(--butter) / 0.7)',
              '--wx-drift': `${m.drift}px`,
              animation: `wxMote ${m.dur}s ease-in-out ${m.delay}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  );
};

const Fog = () => (
  <div className="absolute inset-0">
    {[18, 42, 66].map((top, i) => (
      <span
        key={top}
        className="absolute -left-[20vw] h-[22vh] w-[140vw] rounded-full blur-3xl"
        style={{
          top: `${top}%`,
          background: 'rgb(var(--hairline) / 0.14)',
          animation: `wxFog ${40 + i * 14}s ease-in-out ${-i * 9}s infinite`,
        }}
      />
    ))}
  </div>
);

const Flash = () => (
  <div
    className="wx-moving absolute inset-0"
    style={{ background: 'rgb(var(--ink) / 0.12)', animation: 'wxFlash 9s linear -3s infinite' }}
  />
);

const SCENES = {
  sun: () => <Sun />,
  partly: () => (
    <>
      <Sun strength={0.7} />
      <Clouds count={4} opacity={0.12} />
    </>
  ),
  cloud: () => <Clouds count={7} opacity={0.2} />,
  night: () => <Stars />,
  'night-cloud': () => (
    <>
      <Stars count={40} />
      <Clouds count={5} opacity={0.14} />
    </>
  ),
  'rain-light': () => (
    <>
      <Clouds count={5} opacity={0.14} />
      <Rain level="rain-light" />
    </>
  ),
  rain: () => (
    <>
      <Clouds count={6} opacity={0.18} />
      <Rain level="rain" />
    </>
  ),
  'rain-heavy': () => (
    <>
      <Clouds count={7} opacity={0.2} />
      <Rain level="rain-heavy" />
    </>
  ),
  storm: () => (
    <>
      <Clouds count={7} opacity={0.22} />
      <Rain level="rain-heavy" />
      <Flash />
    </>
  ),
  fog: () => <Fog />,
  snow: () => (
    <>
      <Clouds count={5} opacity={0.14} />
      <Snow />
    </>
  ),
};

const WeatherAnimations = ({ weather }) => {
  const scene = sceneOf(weather);
  const Scene = scene && SCENES[scene];
  if (!Scene) return null;
  return (
    <div className="wx-fx pointer-events-none fixed inset-0 z-0 overflow-hidden" data-scene={scene} aria-hidden="true">
      <Scene />
    </div>
  );
};

// Only a new reading can change the sky; anything else re-rendering the page
// (typing, theme, view switches) leaves it alone.
export default memo(
  WeatherAnimations,
  (a, b) => sceneOf(a.weather) === sceneOf(b.weather)
);
