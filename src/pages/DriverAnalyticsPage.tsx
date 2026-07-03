import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { useParams } from "react-router-dom";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { formatDate, formatLapTime } from "../lib/format";

const MOVING_AVG_WINDOW = 15;

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

function linearRegression(points: { x: number; y: number }[]): (x: number) => number {
  const n = points.length;
  if (n < 2) return () => points[0]?.y ?? 0;
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumXX = points.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sumXX - sumX * sumX;
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return (x: number) => slope * x + intercept;
}

export default function DriverAnalyticsPage() {
  const { driverId } = useParams();
  const id = driverId as Id<"drivers">;
  const driver = useQuery(api.drivers.getById, { driverId: id });
  const laps = useQuery(api.heats.listAllLapsForDriver, { driverId: id });

  const [hideOutlap, setHideOutlap] = useState(true);
  const [hideWet, setHideWet] = useState(true);
  const [removeOutliers, setRemoveOutliers] = useState(false);
  const [showMovingAvg, setShowMovingAvg] = useState(true);
  const [showTrendline, setShowTrendline] = useState(false);

  const chartData = useMemo(() => {
    if (!laps) return [];
    let filtered = hideOutlap ? laps.filter((l) => l.lapNo !== 1) : laps;
    if (hideWet) filtered = filtered.filter((l) => !l.isWet);

    if (removeOutliers && filtered.length > 4) {
      const sorted = [...filtered.map((l) => l.lapTimeMs)].sort((a, b) => a - b);
      const q1 = quantile(sorted, 0.25);
      const q3 = quantile(sorted, 0.75);
      const iqr = q3 - q1;
      const lo = q1 - 1.5 * iqr;
      const hi = q3 + 1.5 * iqr;
      filtered = filtered.filter((l) => l.lapTimeMs >= lo && l.lapTimeMs <= hi);
    }

    const points = filtered.map((l, i) => ({
      x: i,
      lapTimeMs: l.lapTimeMs,
      lapTimeSec: l.lapTimeMs / 1000,
      heatNo: l.heatNo,
      raceDateTime: l.raceDateTime,
    }));

    if (showMovingAvg) {
      for (let i = 0; i < points.length; i++) {
        const start = Math.max(0, i - MOVING_AVG_WINDOW + 1);
        const window = points.slice(start, i + 1);
        (points[i] as Record<string, unknown>).movingAvgSec =
          window.reduce((s, p) => s + p.lapTimeSec, 0) / window.length;
      }
    }

    if (showTrendline && points.length >= 2) {
      const fn = linearRegression(points.map((p) => ({ x: p.x, y: p.lapTimeSec })));
      for (const p of points) {
        (p as Record<string, unknown>).trendSec = fn(p.x);
      }
    }

    return points;
  }, [laps, hideOutlap, hideWet, removeOutliers, showMovingAvg, showTrendline]);

  const recentFirstLaps = useMemo(() => (laps ? [...laps].reverse() : []), [laps]);

  if (driver === undefined || laps === undefined) return <p className="text-neutral-500">Loading…</p>;
  if (driver === null) return <p className="text-neutral-500">Driver not found.</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{driver.displayName} — Analytics</h1>

      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={hideOutlap} onChange={(e) => setHideOutlap(e.target.checked)} />
          Hide out-lap (lap 1)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={hideWet} onChange={(e) => setHideWet(e.target.checked)} />
          Hide wet-race laps
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={removeOutliers} onChange={(e) => setRemoveOutliers(e.target.checked)} />
          Remove outliers (IQR)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={showMovingAvg} onChange={(e) => setShowMovingAvg(e.target.checked)} />
          Moving average ({MOVING_AVG_WINDOW})
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={showTrendline} onChange={(e) => setShowTrendline(e.target.checked)} />
          Linear trendline
        </label>
      </div>

      <ResponsiveContainer width="100%" height={420}>
        <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--chart-gridline)" vertical={false} />
          <XAxis
            dataKey="x"
            stroke="var(--chart-muted)"
            tick={{ fill: "var(--chart-muted)", fontSize: 12 }}
            label={{ value: "Lap # (chronological)", position: "insideBottom", offset: -4, fill: "var(--chart-muted)" }}
          />
          <YAxis
            stroke="var(--chart-muted)"
            tick={{ fill: "var(--chart-muted)", fontSize: 12 }}
            domain={["dataMin - 1", "dataMax + 1"]}
            label={{ value: "Lap time (s)", angle: -90, position: "insideLeft", fill: "var(--chart-muted)" }}
          />
          <Tooltip
            contentStyle={{
              background: "var(--chart-surface)",
              border: "1px solid var(--chart-gridline)",
              fontSize: 12,
            }}
            formatter={(value, name) => {
              const v = Number(value);
              return [
                name === "lapTimeSec" ? formatLapTime(v * 1000) : `${v.toFixed(3)}s`,
                name === "lapTimeSec" ? "Lap time" : name === "movingAvgSec" ? "Moving avg" : "Trend",
              ];
            }}
            labelFormatter={(_, payload) =>
              payload?.[0]?.payload ? `Heat #${payload[0].payload.heatNo} · ${formatDate(payload[0].payload.raceDateTime)}` : ""
            }
          />
          <Scatter dataKey="lapTimeSec" fill="var(--series-1)" opacity={0.6} />
          {showMovingAvg && (
            <Line dataKey="movingAvgSec" stroke="var(--series-2)" strokeWidth={2} dot={false} />
          )}
          {showTrendline && (
            <Line dataKey="trendSec" stroke="var(--series-6)" strokeWidth={2} strokeDasharray="6 4" dot={false} />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      <div>
        <h2 className="text-lg font-semibold mb-3">Raw laps ({chartData.length} shown of {laps.length} total)</h2>
        <div className="max-h-96 overflow-y-auto overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-neutral-500 dark:bg-neutral-900 sticky top-0">
              <tr>
                <th className="px-3 py-2">Heat</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Lap time</th>
              </tr>
            </thead>
            <tbody>
              {recentFirstLaps.map((l, i) => (
                <tr key={i} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="px-3 py-2">
                    #{l.heatNo}
                    {l.isWet && (
                      <span className="ml-2 text-xs" style={{ color: "var(--series-1)" }} title="Wet race">
                        (wet)
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{formatDate(l.raceDateTime)}</td>
                  <td className="px-3 py-2 tabular-nums">{formatLapTime(l.lapTimeMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
