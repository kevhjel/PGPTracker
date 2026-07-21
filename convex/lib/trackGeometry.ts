import { projectToLocalMeters, unprojectFromLocalMeters } from "./geo";

export interface LapPoint {
  lat: number;
  lon: number;
  t: number;
}

export interface RefPolylinePoint {
  distM: number;
  lat: number;
  lon: number;
  x: number;
  y: number;
}

export interface Sector {
  index: number;
  type: "corner" | "straight";
  startDistM: number;
  endDistM: number;
}

export interface BuildParams {
  resampleSpacingM: number;
  curvatureThresholdRadPerM: number;
  minSegmentLengthM: number;
}

// Starting points, not solved values - see convex/lib/trackGeometry.ts docs
// in the project plan for why. Expect to tune these against real laps.
export const DEFAULT_BUILD_PARAMS: BuildParams = {
  resampleSpacingM: 2,
  curvatureThresholdRadPerM: 0.03,
  minSegmentLengthM: 15,
};

const CURVATURE_LOOKAHEAD_M = 6;
const CORNER_SMOOTH_WINDOW = 5;
const EVEN_SECTOR_FALLBACK_COUNT = 12;

function lightSmooth(points: { x: number; y: number }[], window = 2): { x: number; y: number }[] {
  if (points.length < window * 2 + 1) return points;
  return points.map((_, i) => {
    const lo = Math.max(0, i - window);
    const hi = Math.min(points.length - 1, i + window);
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let j = lo; j <= hi; j++) {
      sx += points[j].x;
      sy += points[j].y;
      n++;
    }
    return { x: sx / n, y: sy / n };
  });
}

function cumulativeArcLength(points: { x: number; y: number }[]): number[] {
  const dist = [0];
  for (let i = 1; i < points.length; i++) {
    dist.push(dist[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  return dist;
}

function resampleAtEvenSpacing(
  points: { x: number; y: number }[],
  spacingM: number,
): { x: number; y: number; distM: number }[] {
  const dist = cumulativeArcLength(points);
  const total = dist[dist.length - 1];
  const out: { x: number; y: number; distM: number }[] = [];
  let segIdx = 0;
  for (let d = 0; d <= total; d += spacingM) {
    while (segIdx < dist.length - 2 && dist[segIdx + 1] < d) segIdx++;
    const d0 = dist[segIdx];
    const d1 = dist[segIdx + 1];
    const frac = d1 > d0 ? (d - d0) / (d1 - d0) : 0;
    const p0 = points[segIdx];
    const p1 = points[segIdx + 1];
    out.push({ x: p0.x + (p1.x - p0.x) * frac, y: p0.y + (p1.y - p0.y) * frac, distM: d });
  }
  return out;
}

/** Turning-angle-rate curvature (rad/m) at point i, using neighbors ~lookAheadM away in each direction. */
function curvatureAt(resampled: { x: number; y: number; distM: number }[], i: number, lookAheadM: number): number {
  const targetBehind = resampled[i].distM - lookAheadM;
  const targetAhead = resampled[i].distM + lookAheadM;
  let a = 0;
  let c = resampled.length - 1;
  for (let j = i; j >= 0; j--) {
    if (resampled[j].distM <= targetBehind) {
      a = j;
      break;
    }
  }
  for (let j = i; j < resampled.length; j++) {
    if (resampled[j].distM >= targetAhead) {
      c = j;
      break;
    }
  }
  const A = resampled[a];
  const B = resampled[i];
  const C = resampled[c];
  const angle1 = Math.atan2(B.y - A.y, B.x - A.x);
  const angle2 = Math.atan2(C.y - B.y, C.x - B.x);
  let dAngle = angle2 - angle1;
  while (dAngle > Math.PI) dAngle -= 2 * Math.PI;
  while (dAngle < -Math.PI) dAngle += 2 * Math.PI;
  const arcLen = C.distM - A.distM || 1;
  return Math.abs(dAngle) / arcLen;
}

function classifyAndMergeSectors(
  resampled: { x: number; y: number; distM: number }[],
  params: BuildParams,
): Sector[] {
  const rawCorner = resampled.map((_, i) => curvatureAt(resampled, i, CURVATURE_LOOKAHEAD_M) > params.curvatureThresholdRadPerM);

  // Majority-vote smoothing over a small window to denoise the raw per-point classification.
  const smoothed = rawCorner.map((_, i) => {
    const lo = Math.max(0, i - CORNER_SMOOTH_WINDOW);
    const hi = Math.min(rawCorner.length - 1, i + CORNER_SMOOTH_WINDOW);
    let votes = 0;
    let total = 0;
    for (let j = lo; j <= hi; j++) {
      if (rawCorner[j]) votes++;
      total++;
    }
    return votes > total / 2;
  });

  type Run = { type: "corner" | "straight"; startIdx: number; endIdx: number };
  const runs: Run[] = [];
  let curType: "corner" | "straight" = smoothed[0] ? "corner" : "straight";
  let curStart = 0;
  for (let i = 1; i < smoothed.length; i++) {
    const t: "corner" | "straight" = smoothed[i] ? "corner" : "straight";
    if (t !== curType) {
      runs.push({ type: curType, startIdx: curStart, endIdx: i - 1 });
      curType = t;
      curStart = i;
    }
  }
  runs.push({ type: curType, startIdx: curStart, endIdx: smoothed.length - 1 });

  // Merge any run shorter than minSegmentLengthM into a neighbor.
  const merged = [...runs];
  let changed = true;
  while (changed && merged.length > 1) {
    changed = false;
    for (let i = 0; i < merged.length; i++) {
      const run = merged[i];
      const lengthM = resampled[run.endIdx].distM - resampled[run.startIdx].distM;
      if (lengthM < params.minSegmentLengthM) {
        if (i < merged.length - 1) {
          merged[i + 1] = { ...merged[i + 1], startIdx: run.startIdx };
          merged.splice(i, 1);
        } else if (i > 0) {
          merged[i - 1] = { ...merged[i - 1], endIdx: run.endIdx };
          merged.splice(i, 1);
        }
        changed = true;
        break;
      }
    }
  }

  return merged.map((run, index) => ({
    index,
    type: run.type,
    startDistM: resampled[run.startIdx].distM,
    endDistM: resampled[run.endIdx].distM,
  }));
}

function evenDistanceSectors(totalDistanceM: number, count = EVEN_SECTOR_FALLBACK_COUNT): Sector[] {
  const sectors: Sector[] = [];
  for (let i = 0; i < count; i++) {
    sectors.push({
      index: i,
      type: "straight",
      startDistM: (totalDistanceM / count) * i,
      endDistM: (totalDistanceM / count) * (i + 1),
    });
  }
  return sectors;
}

function isDegenerate(sectors: Sector[]): boolean {
  return sectors.length <= 1 || sectors.length > 40;
}

export function buildTrackReference(
  lapPoints: LapPoint[],
  originLat: number,
  originLon: number,
  params: BuildParams = DEFAULT_BUILD_PARAMS,
): { polyline: RefPolylinePoint[]; sectors: Sector[]; totalDistanceM: number; usedFallbackSectors: boolean } {
  const local = lapPoints.map((p) => projectToLocalMeters(p.lat, p.lon, originLat, originLon));
  const smoothed = lightSmooth(local, 2);
  const resampled = resampleAtEvenSpacing(smoothed, params.resampleSpacingM);
  const totalDistanceM = resampled[resampled.length - 1].distM;

  let sectors = classifyAndMergeSectors(resampled, params);
  const usedFallbackSectors = isDegenerate(sectors);
  if (usedFallbackSectors) {
    sectors = evenDistanceSectors(totalDistanceM);
  }

  const polyline: RefPolylinePoint[] = resampled.map((p) => {
    const { lat, lon } = unprojectFromLocalMeters(p.x, p.y, originLat, originLon);
    return { distM: p.distM, x: p.x, y: p.y, lat, lon };
  });

  return { polyline, sectors, totalDistanceM, usedFallbackSectors };
}
