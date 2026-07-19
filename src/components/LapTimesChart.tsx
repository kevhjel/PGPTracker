import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { seriesColor } from "../lib/chartColors";

interface EntryLike {
  driverNameRaw: string;
  laps: { lapNo: number; lapTimeMs: number }[];
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

export default function LapTimesChart({
  entries,
  selectedNames,
}: {
  entries: EntryLike[];
  selectedNames?: Set<string>;
}) {
  // Skip the out lap (lap 1) - it's run well below race pace, which
  // compresses the rest of the laps at the bottom of the chart and makes
  // individual lap times hard to read.
  const withLaps = entries
    .filter((e) => !selectedNames || selectedNames.has(e.driverNameRaw))
    .map((e) => ({ ...e, laps: e.laps.filter((l) => l.lapNo > 1) }))
    .filter((e) => e.laps.length > 0);
  if (withLaps.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        {selectedNames ? "No drivers selected." : "No lap-by-lap data available for this heat."}
      </p>
    );
  }

  const maxLaps = Math.max(...withLaps.map((e) => e.laps.length));
  const sortedLapsByDriver = withLaps.map((e) => [...e.laps].sort((a, b) => a.lapNo - b.lapNo));

  const chartData = [];
  for (let lap = 0; lap < maxLaps; lap++) {
    const row: Record<string, number> = { lap: lap + 2 };
    withLaps.forEach((e, i) => {
      const entry = sortedLapsByDriver[i][lap];
      if (entry !== undefined) {
        row[e.driverNameRaw] = Math.round((entry.lapTimeMs / 1000) * 1000) / 1000;
      }
    });
    chartData.push(row);
  }

  // Robust Y-axis bounds: a full-range domain gets stretched by rare,
  // extreme-outlier laps (endurance-race pit stops can be several times a
  // normal lap), which flattens the visible pace gaps between racers.
  // Tukey's fences zoom the view to where the real lap times live across
  // the whole field; pit-stop-length laps still plot, just clipped above
  // the visible range instead of dictating the whole scale.
  const allLapTimesSec = withLaps.flatMap((e) => e.laps.map((l) => l.lapTimeMs / 1000));
  let yDomain: [number, number] | undefined;
  if (allLapTimesSec.length >= 4) {
    const sorted = [...allLapTimesSec].sort((a, b) => a - b);
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    const iqr = q3 - q1;
    const dataMin = sorted[0];
    const dataMax = sorted[sorted.length - 1];
    const lo = Math.max(q1 - 1.5 * iqr, dataMin);
    const hi = Math.min(q3 + 1.5 * iqr, dataMax);
    yDomain = [Math.max(0, lo - 1), hi + 1];
  }

  return (
    <ResponsiveContainer width="100%" height={360}>
      <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--chart-gridline)" vertical={false} />
        <XAxis
          dataKey="lap"
          stroke="var(--chart-muted)"
          tick={{ fill: "var(--chart-muted)", fontSize: 12 }}
          label={{ value: "Lap", position: "insideBottom", offset: -4, fill: "var(--chart-muted)" }}
        />
        <YAxis
          stroke="var(--chart-muted)"
          tick={{ fill: "var(--chart-muted)", fontSize: 12 }}
          domain={yDomain ?? ["dataMin - 1", "dataMax + 1"]}
          allowDataOverflow={yDomain !== undefined}
          label={{ value: "Lap time (s)", angle: -90, position: "insideLeft", fill: "var(--chart-muted)" }}
        />
        <Tooltip
          wrapperStyle={{ zIndex: 10 }}
          contentStyle={{
            background: "var(--chart-surface)",
            border: "1px solid var(--chart-gridline)",
            fontSize: 12,
          }}
          formatter={(value) => `${Number(value).toFixed(3)}s`}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {withLaps.map((e, i) => (
          <Line
            key={e.driverNameRaw}
            type="monotone"
            dataKey={e.driverNameRaw}
            stroke={i < 8 ? seriesColor(i) : "var(--chart-muted)"}
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
