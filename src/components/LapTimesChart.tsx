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
import { MAX_VALID_LAP_MS, MIN_VALID_LAP_MS } from "../../convex/lib/constants";

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

// Tukey's fences (q1/q3 +/- 1.5*IQR), clamped to the data's own min/max so a
// clean dataset (no real outliers) just gets its natural range back.
// Undefined if there isn't enough data to compute one meaningfully.
function tukeyFences(valuesSec: number[]): { lo: number; hi: number } | undefined {
  if (valuesSec.length < 4) return undefined;
  const sorted = [...valuesSec].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const dataMin = sorted[0];
  const dataMax = sorted[sorted.length - 1];
  return { lo: Math.max(q1 - 1.5 * iqr, dataMin), hi: Math.min(q3 + 1.5 * iqr, dataMax) };
}

export default function LapTimesChart({
  entries,
  selectedNames,
  heatCategory,
}: {
  entries: EntryLike[];
  selectedNames?: Set<string>;
  heatCategory?: string;
}) {
  // Skip the out lap (lap 1) - it's run well below race pace, which
  // compresses the rest of the laps at the bottom of the chart and makes
  // individual lap times hard to read. Also drop ClubSpeed timing-glitch
  // laps outside [MIN_VALID_LAP_MS, MAX_VALID_LAP_MS] (physically impossible
  // on this track, occasionally recorded as ~0s or a stuck-beacon multi-
  // minute value) - same bounds already used server-side for leaderboards/
  // wetness classification. Unlike the endurance-only pit-lap exclusion
  // below, this applies to every category: a glitch lap draws the same
  // jarring vertical spike regardless of race type, and is never a real lap
  // to begin with.
  const baseEntries = entries
    .filter((e) => !selectedNames || selectedNames.has(e.driverNameRaw))
    .map((e) => ({
      ...e,
      laps: e.laps.filter((l) => l.lapNo > 1 && l.lapTimeMs >= MIN_VALID_LAP_MS && l.lapTimeMs <= MAX_VALID_LAP_MS),
    }))
    .filter((e) => e.laps.length > 0);
  if (baseEntries.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        {selectedNames ? "No drivers selected." : "No lap-by-lap data available for this heat."}
      </p>
    );
  }

  // Endurance races mix real pit-stop laps in with racing laps. Clipping the
  // Y-axis (below) stops them from flattening the whole scale, but a pit lap
  // still draws as a vertical line shooting off the top of the chart and
  // back down - jarring and not useful. Drop pit laps from the trace
  // entirely for endurance heats instead, using the same field-wide fence
  // as the outlier boundary. Other categories don't have this bimodal
  // shape (no pit stops), so their laps are left untouched.
  const fieldFence = tukeyFences(baseEntries.flatMap((e) => e.laps.map((l) => l.lapTimeMs / 1000)));
  const withLaps =
    heatCategory === "endurance" && fieldFence !== undefined
      ? baseEntries
          .map((e) => ({ ...e, laps: e.laps.filter((l) => l.lapTimeMs / 1000 <= fieldFence.hi) }))
          .filter((e) => e.laps.length > 0)
      : baseEntries;
  if (withLaps.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        {selectedNames ? "No drivers selected." : "No lap-by-lap data available for this heat."}
      </p>
    );
  }

  // Key chart rows by each lap's real lapNo (not array position) - drivers
  // can now be missing individual laps (pit laps just removed above, or a
  // retirement), and position-based indexing would silently misalign every
  // later lap for anyone missing an earlier one.
  const allLapNos = withLaps.flatMap((e) => e.laps.map((l) => l.lapNo));
  const minLapNo = Math.min(...allLapNos);
  const maxLapNo = Math.max(...allLapNos);

  const chartData = [];
  for (let lapNo = minLapNo; lapNo <= maxLapNo; lapNo++) {
    const row: Record<string, number> = { lap: lapNo };
    withLaps.forEach((e) => {
      const entry = e.laps.find((l) => l.lapNo === lapNo);
      if (entry !== undefined) {
        row[e.driverNameRaw] = Math.round((entry.lapTimeMs / 1000) * 1000) / 1000;
      }
    });
    chartData.push(row);
  }

  // Robust Y-axis bounds: a full-range domain gets stretched by rare,
  // extreme-outlier laps, which flattens the visible pace gaps between
  // racers. Tukey's fences zoom the view to where the real lap times live
  // across the whole field; for non-endurance heats (no laps dropped
  // above) an outlier lap still plots, just clipped above the visible
  // range instead of dictating the whole scale.
  const axisFence = tukeyFences(withLaps.flatMap((e) => e.laps.map((l) => l.lapTimeMs / 1000)));
  const yDomain: [number, number] | undefined = axisFence && [
    Math.max(0, axisFence.lo - 1),
    axisFence.hi + 1,
  ];

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
