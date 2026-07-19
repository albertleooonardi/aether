// Shared vocabulary for painting a driving route by the rain sampled along it —
// used by both the inline chat map and the full map page, so the colours (and
// what they claim) can never drift apart.
export const LEVEL = {
  dry: { color: '#22c55e', label: 'Dry' },
  light: { color: '#eab308', label: 'Light rain' },
  wet: { color: '#ef4444', label: 'Rain' },
  unknown: { color: '#94a3b8', label: 'No data' },
};

// Older replies were stored before per-segment data existed — fall back to one
// segment covering the whole line.
export const segmentsOf = (route) =>
  route.rain.segments?.length
    ? route.rain.segments
    : [{ from: 0, to: route.coordinates.length - 1, level: route.rain.level }];
