import { projectToLocalMeters } from "./geo";
import type { RefPolylinePoint, Sector } from "./trackGeometry";

export interface ProjectionPoint {
  distM: number;
  t: number;
}

export interface LapProjectionResult {
  points: ProjectionPoint[];
  sectorTimes: number[];
  lapTimeMsRefined?: number;
}

/** Perpendicular projection onto the nearest reference segment, clamped to the segment. */
function nearestDistM(polyline: RefPolylinePoint[], x: number, y: number): number {
  let best = Infinity;
  let bestDist = polyline[0].distM;
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abLenSq = abx * abx + aby * aby;
    const t = abLenSq > 0 ? Math.max(0, Math.min(1, ((x - a.x) * abx + (y - a.y) * aby) / abLenSq)) : 0;
    const px = a.x + abx * t;
    const py = a.y + aby * t;
    const dx = x - px;
    const dy = y - py;
    const distSq = dx * dx + dy * dy;
    if (distSq < best) {
      best = distSq;
      bestDist = a.distM + (b.distM - a.distM) * t;
    }
  }
  return bestDist;
}

/** Drops any point whose matched distance regresses behind the running max, so downstream interpolation sees a monotonic curve. */
function enforceMonotonic(points: ProjectionPoint[]): ProjectionPoint[] {
  const out: ProjectionPoint[] = [];
  let maxDist = -Infinity;
  for (const p of points) {
    if (p.distM >= maxDist) {
      maxDist = p.distM;
      out.push(p);
    }
  }
  return out;
}

function interpolateTimeAtDistance(points: ProjectionPoint[], distM: number): number | undefined {
  if (points.length === 0) return undefined;
  if (distM <= points[0].distM) return points[0].t;
  if (distM >= points[points.length - 1].distM) return points[points.length - 1].t;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (distM >= a.distM && distM <= b.distM) {
      const frac = b.distM > a.distM ? (distM - a.distM) / (b.distM - a.distM) : 0;
      return a.t + (b.t - a.t) * frac;
    }
  }
  return points[points.length - 1].t;
}

/** Extrapolates along the (a,b) segment's own slope to estimate when targetDistM would have been crossed. */
function extrapolateCrossingTime(a: ProjectionPoint, b: ProjectionPoint, targetDistM: number): number | undefined {
  if (b.distM === a.distM) return undefined;
  const frac = (targetDistM - a.distM) / (b.distM - a.distM);
  return a.t + (b.t - a.t) * frac;
}

/** First pair of consecutive points where distance actually increases - skips any leading points clamped to the same distM (e.g. sitting at the start line before moving off). */
function firstMovingPair(points: ProjectionPoint[]): [ProjectionPoint, ProjectionPoint] | undefined {
  for (let i = 0; i < points.length - 1; i++) {
    if (points[i + 1].distM > points[i].distM) return [points[i], points[i + 1]];
  }
  return undefined;
}

/** Last pair of consecutive points where distance actually increases - skips any trailing points clamped at the finish. */
function lastMovingPair(points: ProjectionPoint[]): [ProjectionPoint, ProjectionPoint] | undefined {
  for (let i = points.length - 1; i > 0; i--) {
    if (points[i].distM > points[i - 1].distM) return [points[i - 1], points[i]];
  }
  return undefined;
}

export function projectLapOntoReference(
  lapPoints: { lat: number; lon: number; t: number }[],
  reference: {
    originLat: number;
    originLon: number;
    polyline: RefPolylinePoint[];
    sectors: Sector[];
    totalDistanceM: number;
  },
): LapProjectionResult {
  const rawProjected = lapPoints.map((p) => {
    const { x, y } = projectToLocalMeters(p.lat, p.lon, reference.originLat, reference.originLon);
    return { distM: nearestDistM(reference.polyline, x, y), t: p.t };
  });
  const points = enforceMonotonic(rawProjected);

  const sectorTimes = reference.sectors.map((s) => {
    const entry = interpolateTimeAtDistance(points, s.startDistM);
    const exit = interpolateTimeAtDistance(points, s.endDistM);
    return entry !== undefined && exit !== undefined ? exit - entry : NaN;
  });

  // Refine lap timing beyond the watch's own lap-button/self-crossing split
  // by extrapolating exactly when the path crossed distM=0 and
  // distM=totalDistanceM, using the edge segments' own time/distance slope -
  // the same idea as timing-loop interpolation, though bounded by however
  // loose the original lap split was (see lapSplit.ts's proximity radius),
  // not photocell-precise.
  let lapTimeMsRefined: number | undefined;
  const startPair = firstMovingPair(points);
  const endPair = lastMovingPair(points);
  if (startPair && endPair) {
    const startT = extrapolateCrossingTime(startPair[0], startPair[1], 0);
    const endT = extrapolateCrossingTime(endPair[0], endPair[1], reference.totalDistanceM);
    if (startT !== undefined && endT !== undefined && endT > startT) {
      lapTimeMsRefined = endT - startT;
    }
  }

  return { points, sectorTimes, lapTimeMsRefined };
}
