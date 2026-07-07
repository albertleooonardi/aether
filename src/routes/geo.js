// Deterministic geo helpers.
const R_EARTH_KM = 6371;
const toRad = (deg) => (deg * Math.PI) / 180;

export const haversineKm = ([lat1, lng1], [lat2, lng2]) => {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
};

export const cumulativeKm = (polyline) => {
  const cum = [0];
  for (let i = 1; i < polyline.length; i++) {
    cum[i] = cum[i - 1] + haversineKm(polyline[i - 1], polyline[i]);
  }
  return cum;
};

export const totalDistanceKm = (polyline) => {
  const cum = cumulativeKm(polyline);
  return cum[cum.length - 1] || 0;
};

// Closed octagonal loop around a center; longitude offset scaled by latitude.
export const buildLoopAround = ([lat, lng], radiusKm = 0.9) => {
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.cos(toRad(lat)) || 1);
  const points = [];
  for (let angle = 0; angle < 360; angle += 45) {
    const rad = toRad(angle);
    points.push([lat + dLat * Math.sin(rad), lng + dLng * Math.cos(rad)]);
  }
  points.push(points[0]);
  return points;
};
