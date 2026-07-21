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

export function distanceMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const p = projectToLocalMeters(a.lat, a.lon, b.lat, b.lon);
  return Math.hypot(p.x, p.y);
}
