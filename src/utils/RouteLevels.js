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
export const LEVEL = {
  dry: { stroke: { dark: '#2a78d6', light: '#2a78d6' }, ink: '#3987e5', label: 'Dry' },
  light: { stroke: { dark: '#6da7ec', light: '#1c5cab' }, ink: '#2871cb', label: 'Light rain' },
  wet: { stroke: { dark: '#b7d3f6', light: '#0d366b' }, ink: '#256abf', label: 'Rain' },
  // Warm neutral, deliberately off the blue ramp so "no data" cannot be misread as
  // a rain level — and off the cool slate used for unselected alternative routes,
  // which it used to share a hex with. `dashed` is the secondary encoding: absence
  // of data is signalled by the broken line too, never by colour alone.
  unknown: { stroke: { dark: '#a39c8b', light: '#a39c8b' }, ink: '#8a8578', label: 'No data', dashed: true },
};

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
