import { LEVEL, rainColor, rainGradient, segmentChance, segmentStroke, rainBreakpoints, breakpointHtml } from './RouteLevels';

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// Basemap land, measured: the dark street map after its CSS filter sits near
// #2a2a2a; Esri Light Gray land is #efefef.
const DARK_LAND = '#2a2a2a';
const LIGHT_LAND = '#efefef';

describe('green → red rain ramp', () => {
  test('0% is green and 100% is red, on both basemaps', () => {
    ['dark', 'light'].forEach((theme) => {
      const [r0, g0] = rgb(rainColor(0, theme));
      const [r1, g1] = rgb(rainColor(100, theme));
      expect(g0).toBeGreaterThan(r0); // green dominates at 0%
      expect(r1).toBeGreaterThan(g1 * 2); // red dominates at 100%
    });
  });

  test('the hue walks from green to red as the chance rises', () => {
    const redShare = (c) => {
      const [r, g] = rgb(rainColor(c, 'dark'));
      return r / (r + g);
    };
    [0, 20, 40, 60, 80, 100].reduce((prev, c) => {
      expect(redShare(c)).toBeGreaterThanOrEqual(prev);
      return redShare(c);
    }, 0);
  });

  test('clamps out-of-range and missing values', () => {
    expect(rainColor(-20)).toBe(rainColor(0));
    expect(rainColor(250)).toBe(rainColor(100));
    expect(rainColor(undefined)).toBe(rainColor(0));
  });

  test.each([0, 25, 50, 75, 100])('%s%% stays readable on its basemap', (c) => {
    expect(contrast(rainColor(c, 'dark'), DARK_LAND)).toBeGreaterThanOrEqual(3);
    expect(contrast(rainColor(c, 'light'), LIGHT_LAND)).toBeGreaterThanOrEqual(2.5);
  });

  test('legend gradient lists the ramp in order', () => {
    expect(rainGradient('dark')).toMatch(/^linear-gradient\(90deg, #4ade80, .*#ef4444\)$/);
  });
});

describe('segment colouring', () => {
  test('uses the forecast chance', () => {
    expect(segmentChance({ level: 'dry', chance: 10 })).toBe(10);
  });

  test('rain judged by amount is never painted greener than its level', () => {
    expect(segmentChance({ level: 'wet', chance: 30 })).toBe(75);
    expect(segmentChance({ level: 'light', chance: 5 })).toBe(35);
    expect(segmentChance({ level: 'wet', chance: 95 })).toBe(95);
  });

  test('no forecast keeps the neutral stroke, not a ramp colour', () => {
    expect(segmentStroke({ level: 'unknown', chance: 0 }, 'dark')).toBe(LEVEL.unknown.stroke.dark);
    expect(LEVEL.unknown.dashed).toBe(true);
  });
});

describe('LEVEL badge and swatch colours', () => {
  const levels = Object.values(LEVEL);

  // A badge (ink) that equals a swatch (stroke) of another level reads as that level.
  test('no ink value equals any stroke value', () => {
    const strokes = new Set(levels.flatMap((l) => Object.values(l.stroke)).map((h) => h.toLowerCase()));
    levels.forEach((l) => expect(strokes.has(l.ink.toLowerCase())).toBe(false));
  });

  test('every level carries a stroke for each basemap', () => {
    levels.forEach((l) => {
      expect(l.stroke.dark).toMatch(/^#[0-9a-f]{6}$/i);
      expect(l.stroke.light).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });

  test('dry is green, rain is red', () => {
    const [r, g] = rgb(LEVEL.dry.stroke.dark);
    expect(g).toBeGreaterThan(r);
    const [r2, g2] = rgb(LEVEL.wet.stroke.dark);
    expect(r2).toBeGreaterThan(g2 * 2);
  });

  test('badge ink is legible on both panels', () => {
    levels.forEach((l) => {
      expect(contrast(l.ink, '#ffffff')).toBeGreaterThanOrEqual(3);
      expect(contrast(l.ink, '#171a1f')).toBeGreaterThanOrEqual(3);
    });
  });
});

describe('rainBreakpoints', () => {
  // A straight 100-vertex line heading east, ~1.1 km per step (~110 km total).
  const coords = Array.from({ length: 101 }, (_, i) => [-6.2, 106.8 + i * 0.01]);
  const route = (segments) => ({ coordinates: coords, rain: { level: 'light', segments } });
  const seg = (from, to, chance, level = 'dry') => ({ from, to, chance, level });

  test('marks the start and every real change, with direction', () => {
    const marks = rainBreakpoints(
      route([seg(0, 20, 10), seg(20, 40, 12), seg(40, 60, 45, 'light'), seg(60, 100, 20)])
    );
    expect(marks.map((m) => [m.start || false, m.chance, m.prev])).toEqual([
      [true, 10, null],
      [false, 45, 10], // 10 -> 12 is under the 5-point threshold: no mark
      [false, 20, 45],
    ]);
    expect(marks[1].lon).toBeCloseTo(106.8 + 40 * 0.01, 6);
  });

  test('changes too close together are held back, never lost', () => {
    // maxMarks 2 -> marks at least a third of the route (~37 km) apart.
    const marks = rainBreakpoints(route([seg(0, 5, 0), seg(5, 10, 60, 'wet'), seg(10, 100, 80, 'wet')]), { maxMarks: 2 });
    expect(marks.map((m) => m.chance)).toEqual([0]);
    const later = rainBreakpoints(
      route([seg(0, 5, 0), seg(5, 10, 60, 'wet'), seg(10, 50, 80, 'wet'), seg(50, 100, 80, 'wet')]),
      { maxMarks: 2 }
    );
    expect(later.map((m) => [m.chance, m.prev])).toEqual([[0, null], [80, 0]]);
  });

  test('stretches without a forecast are skipped', () => {
    const marks = rainBreakpoints(route([seg(0, 30, 0), seg(30, 60, 0, 'unknown'), seg(60, 100, 70, 'wet')]));
    expect(marks.map((m) => m.chance)).toEqual([0, 75]);
  });

  test('empty or degenerate routes give no marks', () => {
    expect(rainBreakpoints({ coordinates: [], rain: { segments: [] } })).toEqual([]);
    expect(rainBreakpoints(route([seg(0, 100, 0, 'unknown')]))).toEqual([]);
  });

  test('marker html shows the new chance with an arrow and the ramp colour', () => {
    const html = breakpointHtml({ chance: 60, prev: 20 }, 'dark');
    expect(html).toContain('↑ 60%');
    expect(html).toContain(rainColor(60, 'dark'));
    expect(breakpointHtml({ chance: 10, prev: 50 })).toContain('↓ 10%');
    expect(breakpointHtml({ start: true, chance: 15, prev: null })).toContain('rain-mark--start');
  });
});
