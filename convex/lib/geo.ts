// Equirectangular approximation - fine at track scale (a few hundred
// meters), not meant for anything continent-sized.
const METERS_PER_DEG_LAT = 111320;

export function projectToLocalMeters(
  lat: number,
  lon: number,
  originLat: number,
  originLon: number,
): { x: number; y: number } {
  const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos((originLat * Math.PI) / 180);
  return {
    x: (lon - originLon) * metersPerDegLon,
    y: (lat - originLat) * METERS_PER_DEG_LAT,
  };
}

export function unprojectFromLocalMeters(
  x: number,
  y: number,
  originLat: number,
  originLon: number,
): { lat: number; lon: number } {
  const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos((originLat * Math.PI) / 180);
  return {
    lat: originLat + y / METERS_PER_DEG_LAT,
    lon: originLon + x / metersPerDegLon,
  };
}

export function distanceMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const p = projectToLocalMeters(a.lat, a.lon, b.lat, b.lon);
  return Math.hypot(p.x, p.y);
}

export function boundingBoxCenter(points: { lat: number; lon: number }[]): { lat: number; lon: number } {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLon = Math.min(minLon, p.lon);
    maxLon = Math.max(maxLon, p.lon);
  }
  return { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 };
}
