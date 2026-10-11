import { LEVEL } from './RouteLevels';

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('LEVEL colours', () => {
  const levels = Object.values(LEVEL);

  // A badge (ink) that equals a legend swatch (stroke) of another level reads as
  // that level — this is how light.ink === dry.stroke slipped through.
  // Checked across BOTH stroke ramps (dark and light basemap).
  test('no ink value equals any stroke value in either ramp', () => {
    const strokes = new Set(levels.flatMap((l) => Object.values(l.stroke)).map((h) => h.toLowerCase()));
    expect(strokes.size).toBeGreaterThan(0);
    levels.forEach((l) => expect(strokes.has(l.ink.toLowerCase())).toBe(false));
  });

  test('every level carries a stroke for each basemap', () => {
    levels.forEach((l) => {
      expect(l.stroke.dark).toMatch(/^#[0-9a-f]{6}$/i);
      expect(l.stroke.light).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });

  // Esri World_Light_Gray_Base land, measured by sampling the modal colour of
  // z8/z10 tiles over Sumatra/Java. Water on the same tiles is #d0cfd4.
  describe('light-basemap stroke ramp', () => {
    const LIGHT_LAND = '#efefef';
    const LIGHT_WATER = '#d0cfd4';
    const { dry, light, wet } = LEVEL;

    test.each(['dry', 'light', 'wet', 'unknown'])('%s clears 2:1 against light land', (k) => {
      expect(contrast(LEVEL[k].stroke.light, LIGHT_LAND)).toBeGreaterThanOrEqual(2);
    });

    test.each(['dry', 'light', 'wet'])('%s clears 2:1 against light water', (k) => {
      expect(contrast(LEVEL[k].stroke.light, LIGHT_WATER)).toBeGreaterThanOrEqual(2);
    });

    // On a light surface salience rises with darkness: dry -> light -> wet darkens.
    test('runs light -> dark with rain, adjacent steps visibly distinct', () => {
      expect(lum(dry.stroke.light) - lum(light.stroke.light)).toBeGreaterThanOrEqual(0.06);
      expect(lum(light.stroke.light) - lum(wet.stroke.light)).toBeGreaterThanOrEqual(0.06);
    });
  });

  test('dark ramp still runs dark -> light with rain', () => {
    const { dry, light, wet } = LEVEL;
    expect(lum(dry.stroke.dark)).toBeLessThan(lum(light.stroke.dark));
    expect(lum(light.stroke.dark)).toBeLessThan(lum(wet.stroke.dark));
  });

  test('ink is monotone across dry -> light -> wet and is legible on both panels', () => {
    const { dry, light, wet } = LEVEL;
    expect(lum(dry.ink)).toBeGreaterThan(lum(light.ink));
    expect(lum(light.ink)).toBeGreaterThan(lum(wet.ink));
    levels.forEach((l) => {
      expect(contrast(l.ink, '#ffffff')).toBeGreaterThanOrEqual(3);
      expect(contrast(l.ink, '#171a1f')).toBeGreaterThanOrEqual(3);
    });
  });
});
