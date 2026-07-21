import { distanceMeters } from "./geo";
import type { GpxPoint } from "./gpxParse";

// Consumer GPS accuracy is ~3-5m (worse under tree cover), so the proximity
// radius needs enough margin to reliably catch a real crossing without
// requiring the watch to retrace its exact prior path.
const START_PROXIMITY_M = 18;
// Must clear this distance from the start point before a crossing can
// re-trigger, so the watch doesn't count multiple "laps" from GPS jitter
// right at the start/finish line, or a slow pit-lane exit that lingers
// nearby before heading out.
const MIN_AWAY_M = 100;
// Backstop against a spurious near-instant re-crossing even after clearing
// MIN_AWAY_M (e.g. a track shape that loops back close to start mid-lap).
const MIN_LAP_DURATION_MS = 10_000;

/**
 * Splits one continuous, unlapped GPX recording into laps by detecting when
 * the path returns near its own starting point - most GPX exporters don't
 * preserve watch lap-button presses as separate <trkseg> elements (that's
 * a TCX/FIT concept), so a single trkseg spanning an entire multi-lap
 * session is the common case, not the exception. This only needs the lap's
 * own path, so it works even before any persistent trackReference exists.
 */
export function splitLapsBySelfCrossing(points: GpxPoint[]): GpxPoint[][] {
  if (points.length < 2) return [points];

  const start = points[0];
  const laps: GpxPoint[][] = [];
  let current: GpxPoint[] = [points[0]];
  let hasBeenAway = false;
  let lastSplitTime = points[0].t;

  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    current.push(p);
    const distFromStart = distanceMeters(p, start);

    if (!hasBeenAway) {
      if (distFromStart > MIN_AWAY_M) hasBeenAway = true;
      continue;
    }

    if (distFromStart <= START_PROXIMITY_M && p.t - lastSplitTime >= MIN_LAP_DURATION_MS) {
      laps.push(current);
      current = [p];
      hasBeenAway = false;
      lastSplitTime = p.t;
    }
  }
  if (current.length > 1) laps.push(current);

  return laps.length > 0 ? laps : [points];
}
