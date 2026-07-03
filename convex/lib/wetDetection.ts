export const MIN_ENTRIES_FOR_CLASSIFICATION = 3;
export const WET_RATIO_THRESHOLD = 1.3;
export const BASELINE_SAMPLE_SIZE = 150;

export function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export interface WetClassification {
  bestLapRatio: number;
  avgLapRatio: number;
  isWet: boolean;
  sampleSize: number;
}

/**
 * Compares a heat's median lap times against a category's dry-pace baseline.
 * Requires both the best-lap and avg-lap ratios to clear the threshold so a
 * single skewed metric (e.g. one driver's unusually clean/messy run) can't
 * flip the call on its own. Returns null when there isn't enough data to
 * classify (too few valid entries) - callers should leave wetness fields
 * unset in that case rather than guessing.
 */
export function classifyWetness(
  bestLapsMs: number[],
  avgLapsMs: number[],
  baselineFastLapMs: number,
  baselineFastAvgLapMs: number,
  minValidLapMs: number,
): WetClassification | null {
  const validBest = bestLapsMs.filter((v) => v >= minValidLapMs);
  if (validBest.length < MIN_ENTRIES_FOR_CLASSIFICATION) return null;

  const validAvg = avgLapsMs.filter((v) => v >= minValidLapMs);
  const bestLapRatio = median(validBest)! / baselineFastLapMs;
  const avgLapRatio = validAvg.length > 0 ? median(validAvg)! / baselineFastAvgLapMs : bestLapRatio;

  return {
    bestLapRatio,
    avgLapRatio,
    isWet: bestLapRatio >= WET_RATIO_THRESHOLD && avgLapRatio >= WET_RATIO_THRESHOLD,
    sampleSize: validBest.length,
  };
}
