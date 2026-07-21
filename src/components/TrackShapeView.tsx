import { computeSvgTransform } from "../lib/mapProjection";
import type { Point } from "../lib/mapProjection";
import { sequentialColor, divergingColor } from "../lib/colorScale";
import TrackBackdrop from "./TrackBackdrop";

interface RefPolylinePoint extends Point {
  distM: number;
}

interface ProjectionPoint {
  distM: number;
  t: number;
}

interface ProjectedLap {
  lapIndex: number;
  projection?: { points: ProjectionPoint[] } | null;
}

export type ShapeMode = "speed" | "delta";

function computeSpeedAtDistance(points: ProjectionPoint[], distM: number): number | undefined {
  if (points.length < 2) return undefined;
  if (distM < points[0].distM || distM > points[points.length - 1].distM) return undefined;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (distM >= a.distM && distM <= b.distM) {
      const dtSec = (b.t - a.t) / 1000;
      const ddM = b.distM - a.distM;
      return dtSec > 0 ? ddM / dtSec : undefined;
    }
  }
  return undefined;
}

// Same "no data outside what the lap covered" rule as trackProjection.ts's
// version - see that file for why clamping instead would be misleading here.
function interpolateTimeAtDistance(points: ProjectionPoint[], distM: number): number | undefined {
  if (points.length === 0) return undefined;
  if (distM < points[0].distM || distM > points[points.length - 1].distM) return undefined;
  if (distM === points[0].distM) return points[0].t;
  if (distM === points[points.length - 1].distM) return points[points.length - 1].t;
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

function buildSegments(
  polyline: RefPolylinePoint[],
  toSvg: (p: Point) => [number, number],
  values: (number | undefined)[],
  colorFor: (v: number) => string,
): { x1: number; y1: number; x2: number; y2: number; color: string }[] {
  const out: { x1: number; y1: number; x2: number; y2: number; color: string }[] = [];
  for (let i = 0; i < polyline.length - 1; i++) {
    const v = values[i];
    if (v === undefined) continue;
    const [x1, y1] = toSvg(polyline[i]);
    const [x2, y2] = toSvg(polyline[i + 1]);
    out.push({ x1, y1, x2, y2, color: colorFor(v) });
  }
  return out;
}

export default function TrackShapeView({
  outline,
  innerEdge,
  outerEdge,
  referencePolyline,
  mode,
  speedLap,
  deltaBaseLap,
  deltaCompareLap,
}: {
  outline?: Point[];
  innerEdge?: Point[];
  outerEdge?: Point[];
  referencePolyline?: RefPolylinePoint[];
  mode: ShapeMode;
  speedLap?: ProjectedLap;
  deltaBaseLap?: ProjectedLap;
  deltaCompareLap?: ProjectedLap;
}) {
  const allPoints = [...(outline ?? []), ...(innerEdge ?? []), ...(outerEdge ?? []), ...(referencePolyline ?? [])];
  const transform = computeSvgTransform(allPoints);
  if (!transform || !referencePolyline) {
    return <p className="text-sm text-neutral-500">Build a track reference first.</p>;
  }
  const { toSvg, width, height } = transform;

  let segments: { x1: number; y1: number; x2: number; y2: number; color: string }[] = [];
  let legend: { label: string; kind: "sequential" | "diverging" } | null = null;

  if (mode === "speed" && speedLap?.projection) {
    const points = speedLap.projection.points;
    const values = referencePolyline.map((p) => computeSpeedAtDistance(points, p.distM));
    const valid = values.filter((v): v is number => v !== undefined);
    if (valid.length > 0) {
      const min = Math.min(...valid);
      const max = Math.max(...valid);
      segments = buildSegments(referencePolyline, toSvg, values, (v) =>
        sequentialColor(max > min ? (v - min) / (max - min) : 0.5),
      );
      legend = { label: `Slow (${min.toFixed(1)} m/s) → Fast (${max.toFixed(1)} m/s)`, kind: "sequential" };
    }
  } else if (mode === "delta" && deltaBaseLap?.projection && deltaCompareLap?.projection) {
    const basePts = deltaBaseLap.projection.points;
    const comparePts = deltaCompareLap.projection.points;
    const baseStart = basePts[0]?.t ?? 0;
    const compareStart = comparePts[0]?.t ?? 0;
    const values = referencePolyline.map((p) => {
      const bt = interpolateTimeAtDistance(basePts, p.distM);
      const ct = interpolateTimeAtDistance(comparePts, p.distM);
      if (bt === undefined || ct === undefined) return undefined;
      return (ct - compareStart) / 1000 - (bt - baseStart) / 1000;
    });
    const valid = values.filter((v): v is number => v !== undefined);
    if (valid.length > 0) {
      const maxAbs = Math.max(...valid.map((v) => Math.abs(v)), 0.01);
      segments = buildSegments(referencePolyline, toSvg, values, (v) => divergingColor(v / maxAbs));
      legend = {
        label: `Lap ${deltaCompareLap.lapIndex + 1} gaining vs Lap ${deltaBaseLap.lapIndex + 1} ← → losing`,
        kind: "diverging",
      };
    }
  }

  return (
    <div className="space-y-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="mx-auto block w-full max-w-3xl rounded-lg border border-neutral-200 dark:border-neutral-800"
        style={{ background: "var(--chart-surface)" }}
      >
        <TrackBackdrop transform={transform} outline={outline} innerEdge={innerEdge} outerEdge={outerEdge} />
        {segments.length === 0 && (
          <path
            d={referencePolyline.map((p, i) => `${i === 0 ? "M" : "L"}${toSvg(p).join(",")}`).join(" ")}
            fill="none"
            stroke="var(--chart-muted)"
            strokeWidth={2}
            strokeDasharray="4 3"
          />
        )}
        {segments.map((s, i) => (
          <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.color} strokeWidth={4} strokeLinecap="round" />
        ))}
      </svg>
      {legend ? (
        <div className="mx-auto flex max-w-3xl items-center justify-center gap-2 text-xs text-neutral-500">
          {legend.kind === "sequential" ? (
            <div className="h-2 w-32 rounded-full" style={{ background: "linear-gradient(to right, var(--seq-low), var(--seq-high))" }} />
          ) : (
            <div
              className="h-2 w-32 rounded-full"
              style={{ background: "linear-gradient(to right, var(--series-1), var(--chart-gridline), var(--series-6))" }}
            />
          )}
          <span>{legend.label}</span>
        </div>
      ) : (
        <p className="text-center text-sm text-neutral-500">
          {mode === "speed" ? "Select a lap with track projection to see its speed map." : "Select two projected laps to compare."}
        </p>
      )}
    </div>
  );
}
