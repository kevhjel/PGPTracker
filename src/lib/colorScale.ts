function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", "").trim(), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b]
    .map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0"))
    .join("")}`;
}

function lerpColor(hexA: string, hexB: string, t: number): string {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  return rgbToHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
}

function cssVar(name: string): string {
  if (typeof document === "undefined") return "#888888";
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || "#888888";
}

/** Magnitude encoding (e.g. speed): t in [0,1], low->high along the single-hue sequential ramp. */
export function sequentialColor(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  return lerpColor(cssVar("--seq-low"), cssVar("--seq-high"), clamped);
}

/** Polarity encoding (e.g. delta time): t in [-1,1], negative = gaining (blue), positive = losing (red), 0 = neutral gray. */
export function divergingColor(t: number): string {
  const clamped = Math.max(-1, Math.min(1, t));
  const neutral = cssVar("--chart-gridline");
  if (clamped >= 0) return lerpColor(neutral, cssVar("--series-6"), clamped);
  return lerpColor(neutral, cssVar("--series-1"), -clamped);
}
