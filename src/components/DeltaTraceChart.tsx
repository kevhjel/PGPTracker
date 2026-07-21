import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { seriesColor } from "../lib/chartColors";

interface ProjectionPoint {
  distM: number;
  t: number;
}

interface ProjectedLap {
  lapIndex: number;
  projection?: { points: ProjectionPoint[] } | null;
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

/**
 * Compares each lap's cumulative time-vs-distance curve against a chosen
 * base lap, interpolated onto the reference track's own distance grid.
 * Positive = losing time vs the base lap at that point on track, negative
 * = gaining - stated explicitly since the sign is a common source of
 * confusion in this kind of chart.
 */
export default function DeltaTraceChart({
  referenceDistances,
  baseLap,
  compareLaps,
}: {
  referenceDistances: number[];
  baseLap: ProjectedLap;
  compareLaps: ProjectedLap[];
}) {
  if (!baseLap.projection || baseLap.projection.points.length === 0) {
    return <p className="text-sm text-neutral-500">Base lap has no track projection yet.</p>;
  }
  const baseStart = baseLap.projection.points[0].t;
  const basePoints = baseLap.projection.points;

  const chartData = referenceDistances.map((d) => {
    const row: Record<string, number> = { distM: d };
    const baseT = interpolateTimeAtDistance(basePoints, d);
    if (baseT === undefined) return row;
    for (const lap of compareLaps) {
      if (!lap.projection || lap.projection.points.length === 0) continue;
      const lapStart = lap.projection.points[0].t;
      const lapT = interpolateTimeAtDistance(lap.projection.points, d);
      if (lapT === undefined) continue;
      row[`lap${lap.lapIndex}`] = (lapT - lapStart) / 1000 - (baseT - baseStart) / 1000;
    }
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--chart-gridline)" vertical={false} />
        <XAxis
          dataKey="distM"
          stroke="var(--chart-muted)"
          tick={{ fill: "var(--chart-muted)", fontSize: 12 }}
          label={{ value: "Track distance (m)", position: "insideBottom", offset: -4, fill: "var(--chart-muted)" }}
        />
        <YAxis
          stroke="var(--chart-muted)"
          tick={{ fill: "var(--chart-muted)", fontSize: 12 }}
          label={{ value: "Delta vs base lap (s)", angle: -90, position: "insideLeft", fill: "var(--chart-muted)" }}
        />
        <ReferenceLine y={0} stroke="var(--chart-baseline)" />
        <Tooltip
          wrapperStyle={{ zIndex: 10 }}
          contentStyle={{ background: "var(--chart-surface)", border: "1px solid var(--chart-gridline)", fontSize: 12 }}
          formatter={(value) => `${Number(value) >= 0 ? "+" : ""}${Number(value).toFixed(3)}s`}
        />
        {compareLaps.map((lap, i) => (
          <Line
            key={lap.lapIndex}
            type="monotone"
            dataKey={`lap${lap.lapIndex}`}
            name={`Lap ${lap.lapIndex + 1}`}
            stroke={seriesColor(i)}
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
