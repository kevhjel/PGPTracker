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

export default function GapFromLeaderChart({ entries }: { entries: EntryLike[] }) {
  const withLaps = entries.filter((e) => e.laps.length > 0);
  if (withLaps.length === 0) {
    return <p className="text-sm text-neutral-500">No lap-by-lap data available for this heat.</p>;
  }

  const maxLaps = Math.max(...withLaps.map((e) => e.laps.length));
  const cumulativeByDriver = withLaps.map((e) => {
    let sum = 0;
    return [...e.laps]
      .sort((a, b) => a.lapNo - b.lapNo)
      .map((l) => {
        sum += l.lapTimeMs;
        return sum;
      });
  });

  const chartData = [];
  for (let lap = 0; lap < maxLaps; lap++) {
    const row: Record<string, number> = { lap: lap + 1 };
    const cumsAtLap = withLaps
      .map((_, i) => cumulativeByDriver[i][lap])
      .filter((v): v is number => v !== undefined);
    if (cumsAtLap.length === 0) continue;
    const leaderTime = Math.min(...cumsAtLap);
    withLaps.forEach((e, i) => {
      const cum = cumulativeByDriver[i][lap];
      if (cum !== undefined) {
        row[e.driverNameRaw] = Math.round(((cum - leaderTime) / 1000) * 1000) / 1000;
      }
    });
    chartData.push(row);
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
          label={{ value: "Gap (s)", angle: -90, position: "insideLeft", fill: "var(--chart-muted)" }}
        />
        <Tooltip
          contentStyle={{
            background: "var(--chart-surface)",
            border: "1px solid var(--chart-gridline)",
            fontSize: 12,
          }}
          formatter={(value) => `+${Number(value).toFixed(3)}s`}
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
