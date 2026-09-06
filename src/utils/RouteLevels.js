// Shared vocabulary for painting a driving route by the rain sampled along it —
// used by both the inline chat map and the full map page, so the colours (and
// what they claim) can never drift apart.
//
// WHY TWO COLOURS PER LEVEL: these values do double duty — a stroke on the dark
// map basemap, and badge/legend ink on the app panel, which follows the light or
// dark theme. Those have opposite contrast requirements (a stroke that reads on a
// near-black map is invisible as text on a white panel), so one hex cannot serve
// both. `stroke` is tuned against the basemap; `ink` against the panel.
//
// WHY BLUE AND NOT A TRAFFIC LIGHT: dry → light → wet is an ORDERED sequence, so
// it takes a single-hue ramp whose lightness carries the order — not the previous
// green/amber/red, which spent three unrelated hues on ordered data and put the
// main signal (dry vs rain) on the red-green axis that ~8% of men cannot separate.
// Blue also happens to be the honest hue for water.
//
// The ramp runs DARK → LIGHT as rain increases because the basemap is dark: on a
// dark surface the lighter step is the salient one, so wet segments glow and dry
// stretches recede, which is the read this map exists to give.
//
// Steps are from the documented blue ramp (450/300/150) and were validated, not
// eyeballed: monotone lightness, adjacent ΔL ≥ 0.06, single hue, and the dry end
// clearing 2:1 against the LIGHTEST part of the basemap (landmass ~#3a3a3a, where
// a darker ramp failed at 1.40:1). `ink` steps (400/450/500) each clear 3:1 on
// both a white and a near-black panel.
export const LEVEL = {
  dry: { stroke: '#2a78d6', ink: '#3987e5', label: 'Dry' },
  light: { stroke: '#6da7ec', ink: '#2a78d6', label: 'Light rain' },
  wet: { stroke: '#b7d3f6', ink: '#256abf', label: 'Rain' },
  // Warm neutral, deliberately off the blue ramp so "no data" cannot be misread as
  // a rain level — and off the cool slate used for unselected alternative routes,
  // which it used to share a hex with. `dashed` is the secondary encoding: absence
  // of data is signalled by the broken line too, never by colour alone.
  unknown: { stroke: '#a39c8b', ink: '#8a8578', label: 'No data', dashed: true },
};

// The muted line for routes the user has not selected. Cool and recessive, and no
// longer the same value as LEVEL.unknown.
export const ALT_ROUTE_COLOR = '#94a3b8';

// Older replies were stored before per-segment data existed — fall back to one
// segment covering the whole line.
export const segmentsOf = (route) =>
  route.rain.segments?.length
    ? route.rain.segments
    : [{ from: 0, to: route.coordinates.length - 1, level: route.rain.level }];
