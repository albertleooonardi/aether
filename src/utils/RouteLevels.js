// Shared vocabulary for painting a driving route by the rain sampled along it —
// used by both the inline chat map and the full map page, so the colours (and
// what they claim) can never drift apart.
//
// WHY TWO COLOURS PER LEVEL: these values do double duty — a stroke on the map
// basemap, and badge ink on the app panel, which follows the light or dark
// theme. Those have opposite contrast requirements (a stroke that reads on a
// near-black map is invisible as text on a white panel), so one hex cannot serve
// both. `stroke` is tuned against the basemap; `ink` against the panel.
//
// WHY THERE ARE NOW TWO STROKE RAMPS: MapPage draws routes on BOTH Esri basemaps
// (Dark Gray and Light Gray), following the app theme, so `stroke` is
// { dark, light } and each ramp is anchored to its own surface. A single
// dark-basemap ramp put its wet step (#b7d3f6) at 1.34:1 on Light Gray land and
// inverted the salience order. Use `strokeOf(level, theme)`. The inline chat map
// (ChatRouteMap) always draws on the dark basemap, so it takes `.stroke.dark`, as
// do the legend/badge chips, which sit on a dark backing in either theme.
//
// WHICH TOKEN WHERE (do not "fix" either toward the other):
//   - The LEGEND samples the drawn map line, so it uses `stroke` — map fidelity is
//     its job — on a small dark chip, which supplies the contrast the panel can't.
//   - The per-route BADGE is text on the panel, so it uses `ink` and its 3:1.
// The two ramps therefore run in OPPOSITE directions by design (stroke dark→light
// with rain, ink the reverse): a dark basemap and a light panel want opposite
// things. Because the ramps run in opposite directions they used to cross, and
// `light.ink` was literally `dry.stroke` — a badge the same hex the legend beside
// it labels "Dry". So `ink` steps are DELIBERATELY DISJOINT from every `stroke`
// step (asserted in RouteLevels.test.js); re-stepping either ramp must keep it so.
//
// WHY BLUE AND NOT A TRAFFIC LIGHT: dry → light → wet is an ORDERED sequence, so
// it takes a single-hue ramp whose lightness carries the order — not the previous
// green/amber/red, which spent three unrelated hues on ordered data and put the
// main signal (dry vs rain) on the red-green axis that ~8% of men cannot separate.
// Blue also happens to be the honest hue for water.
//
// The DARK ramp runs DARK → LIGHT as rain increases because the basemap is dark: on
// a dark surface the lighter step is the salient one, so wet segments glow and dry
// stretches recede, which is the read this map exists to give. The LIGHT ramp runs
// the opposite way, LIGHT → DARK, for the same reason: on Light Gray the darker
// step is the salient one.
//
// LIGHT ramp, measured: Esri Light Gray land is #efefef (the modal colour of land
// tiles sampled at z8/z10 over Sumatra/Java; water is #d0cfd4). Strokes use blue
// steps 450 / 550 / 700 — contrast vs land: dry #2a78d6 3.84, light #1c5cab 5.76,
// wet #0d366b 10.39; vs water: 2.85 / 4.28 / 7.72. Every step clears 2:1 on both
// (asserted in RouteLevels.test.js). Steps 400 and 500 were skipped on purpose:
// they are `ink` values (#3987e5, #256abf) and ink must stay disjoint from stroke.
//
// Steps are from the documented blue ramp (450/300/150) and were validated, not
// eyeballed: monotone lightness, adjacent ΔL ≥ 0.06, single hue, and the dry end
// clearing 2:1 against the LIGHTEST part of the basemap (landmass ~#3a3a3a, where
// a darker ramp failed at 1.40:1). `ink` steps each clear 3:1 on both the white
// panel and the dark panel (#171a1f), measured: dry 400 #3987e5 3.64 / 4.79,
// light #2871cb 4.87 / 3.58, wet 500 #256abf 5.39 / 3.23 (white / dark).
// WHY #2871cb IS OFF THE DOCUMENTED RAMP: only steps 400-500 clear 3:1 on both
// panels (350 is 2.99 on white; 550 is ~2.7 on dark), and 450 is `dry.stroke`, so
// the ramp has only two usable non-stroke steps for three levels. `light.ink` is
// the 450/500 midpoint, keeping the same hue and the dry → light → wet order.
// ── GREEN → RED (current scheme) ────────────────────────────────────────────
// Requested design: a road is coloured by its chance of rain, green at 0% through
// lime, yellow and orange to red at 100%. The blue-ramp notes above are history.
// Red-green alone is hard for ~8% of men to separate, so the ramp also moves in
// lightness, every tooltip and badge states the % in words, and "no data" keeps
// its dashed line.
//
// Strokes are tuned per basemap (contrast vs land, measured): dark basemap
// (~#2a2a2a) green 8.2 · lime 9.5 · yellow 9.4 · orange 6.3 · red 3.8; light
// basemap (#efefef) green 2.9 · lime 2.7 · yellow 2.6 · orange 3.1 · red 4.2.
// `ink` (badge text on the panel) clears 3:1 on white AND on the dark panel
// #171a1f: dry #15803d 5.0/3.5 · light #d97706 3.2/5.5 · wet #e11d48 4.7/3.7, and
// stays disjoint from every stroke (asserted in RouteLevels.test.js).
export const LEVEL = {
  dry: { stroke: { dark: '#4ade80', light: '#16a34a' }, ink: '#15803d', label: 'Dry' },
  light: { stroke: { dark: '#facc15', light: '#ca8a04' }, ink: '#d97706', label: 'Light rain' },
  wet: { stroke: { dark: '#ef4444', light: '#dc2626' }, ink: '#e11d48', label: 'Rain' },
  // Warm neutral, off the green→red ramp so "no data" cannot be misread as a
  // rain level. `dashed` is the secondary encoding: absence of data is signalled
  // by the broken line too, never by colour alone.
  unknown: { stroke: { dark: '#a39c8b', light: '#7a7468' }, ink: '#8a8578', label: 'No data', dashed: true },
};

// Continuous ramp for a chance of rain, 0–100.
const RAMP = {
  dark: ['#4ade80', '#a3e635', '#facc15', '#fb923c', '#ef4444'],
  light: ['#16a34a', '#65a30d', '#ca8a04', '#ea580c', '#dc2626'],
};

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgbToHex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

export const rainColor = (chance, theme = 'dark') => {
  const stops = RAMP[theme] || RAMP.dark;
  const t = Math.max(0, Math.min(100, Number(chance) || 0)) / 100;
  const pos = t * (stops.length - 1);
  const i = Math.min(Math.floor(pos), stops.length - 2);
  const f = pos - i;
  const [a, b] = [hexToRgb(stops[i]), hexToRgb(stops[i + 1])];
  return rgbToHex(a.map((v, k) => v + (b[k] - v) * f));
};

// CSS gradient of the whole ramp, for legends.
export const rainGradient = (theme = 'dark') => `linear-gradient(90deg, ${(RAMP[theme] || RAMP.dark).join(', ')})`;

// The chance a segment is painted at. Mostly the forecast chance, but a stretch
// classed as rain because of the AMOUNT expected (or rain falling right now) is
// never shown greener than its level: 'light' paints at least 35%, 'wet' 75%.
export const segmentChance = (s) => {
  const c = typeof s.chance === 'number' ? s.chance : s.level === 'wet' ? 75 : s.level === 'light' ? 35 : 0;
  if (s.level === 'wet') return Math.max(c, 75);
  if (s.level === 'light') return Math.max(c, 35);
  return c;
};

// The colour a drawn segment gets: the ramp by chance, or the dashed neutral
// when there is no forecast for it.
export const segmentStroke = (s, theme = 'dark') =>
  s.level === 'unknown' ? strokeOf(LEVEL.unknown, theme) : rainColor(segmentChance(s), theme);

// The stroke for a level on the given basemap theme ('dark' | 'light').
export const strokeOf = (level, theme) => (level || LEVEL.unknown).stroke[theme] || (level || LEVEL.unknown).stroke.dark;

// The muted line for routes the user has not selected. Cool and recessive, and no
// longer the same value as LEVEL.unknown.
export const ALT_ROUTE_COLOR = '#94a3b8';

// Older replies were stored before per-segment data existed — fall back to one
// segment covering the whole line.
export const segmentsOf = (route) =>
  route.rain.segments?.length
    ? route.rain.segments
    : [{ from: 0, to: route.coordinates.length - 1, level: route.rain.level }];

/* ---------------- where the chance of rain changes ---------------- */

const kmBetween = (a, b) => {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLon = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(a[0] * rad) * Math.cos(b[0] * rad);
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

/*
 * Points along a route where the chance of rain changes, for the markers drawn
 * on the line. The first entry is the start of the trip (`start: true`) so the
 * opening stretch has a value too.
 *
 * Two filters keep the line readable:
 *  - a change smaller than `minDelta` points is not a change worth a marker;
 *  - a change closer than 1/(maxMarks+1) of the route to the previous marker is
 *    held back, and lands at the next stretch that is far enough along (the
 *    comparison stays against the last value SHOWN, so it is never lost).
 * Stretches without a forecast are skipped: their dashed line already says so.
 */
export const rainBreakpoints = (route, { minDelta = 5, maxMarks = 10 } = {}) => {
  const coords = route?.coordinates || [];
  if (coords.length < 2) return [];
  const segs = segmentsOf(route).filter((s) => s.level !== 'unknown' && coords[s.from]);
  if (!segs.length) return [];

  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum[i] = cum[i - 1] + kmBetween(coords[i - 1], coords[i]);
  const minGap = (cum[cum.length - 1] || 0) / (maxMarks + 1);

  const first = segs[0];
  let shown = Math.round(segmentChance(first));
  let lastKm = cum[first.from] || 0;
  const marks = [
    { start: true, lat: coords[first.from][0], lon: coords[first.from][1], chance: shown, prev: null, at: first.at, km: lastKm },
  ];

  for (let k = 1; k < segs.length && marks.length <= maxMarks; k++) {
    const s = segs[k];
    const chance = Math.round(segmentChance(s));
    if (Math.abs(chance - shown) < minDelta) continue;
    const km = cum[s.from] || 0;
    if (km - lastKm < minGap) continue;
    marks.push({ lat: coords[s.from][0], lon: coords[s.from][1], chance, prev: shown, at: s.at, km });
    shown = chance;
    lastKm = km;
  }
  return marks;
};

// Marker HTML for one breakpoint: a delimiter dot on the line in the new colour,
// and a chip beside it with the new chance and which way it moved.
export const breakpointHtml = (m, theme = 'dark') => {
  const color = rainColor(m.chance, theme);
  const arrow = m.start ? '' : m.chance > m.prev ? '↑ ' : '↓ ';
  const label = m.start ? `${m.chance}%` : `${arrow}${m.chance}%`;
  return (
    `<div class="rain-mark${m.start ? ' rain-mark--start' : ''}">` +
    `<span class="rain-mark__dot" style="background:${color}"></span>` +
    `<span class="rain-mark__chip"><i style="background:${color}"></i>${label}</span>` +
    '</div>'
  );
};
