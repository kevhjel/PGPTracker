import { useState } from "react";
import { useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { formatDate, formatHeatCategory, formatLapTime } from "../lib/format";

const CATEGORIES = [
  "arrive_and_drive",
  "league",
  "pro_am",
  "group_event",
  "practice",
  "endurance",
  "other",
] as const;

export default function LeaderboardPage() {
  const [category, setCategory] = useState<string | null>(null);
  const [mode, setMode] = useState<"all_time" | "date_range">("all_time");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const allTime = useQuery(
    api.drivers.allTimeLeaderboard,
    mode === "all_time" ? { category: category ?? undefined, limit: 100 } : "skip",
  );
  const dateScoped = useQuery(
    api.heats.dateScopedLeaderboard,
    mode === "date_range"
      ? {
          category: category ?? undefined,
          fromMs: fromDate ? new Date(fromDate).getTime() : undefined,
          toMs: toDate ? new Date(toDate).getTime() : undefined,
          limit: 100,
        }
      : "skip",
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Leaderboard</h1>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex gap-1">
          <button
            onClick={() => setMode("all_time")}
            className={`rounded-md px-3 py-1.5 text-sm ${mode === "all_time" ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "border border-neutral-300 dark:border-neutral-700"}`}
          >
            All-time
          </button>
          <button
            onClick={() => setMode("date_range")}
            className={`rounded-md px-3 py-1.5 text-sm ${mode === "date_range" ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "border border-neutral-300 dark:border-neutral-700"}`}
          >
            Date range
          </button>
        </div>

        <select
          value={category ?? ""}
          onChange={(e) => setCategory(e.target.value || null)}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        >
          <option value="">All heat types</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {formatHeatCategory(c)}
            </option>
          ))}
        </select>

        {mode === "date_range" && (
          <>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
            <span className="text-neutral-500">to</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
          </>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-neutral-500 dark:bg-neutral-900">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Driver</th>
              <th className="px-3 py-2">Best Lap</th>
              <th className="px-3 py-2">Heat</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Total Laps</th>
            </tr>
          </thead>
          <tbody>
            {mode === "all_time" &&
              allTime?.map((row, i) => (
                <tr key={row.driver._id} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="px-3 py-2 tabular-nums">{i + 1}</td>
                  <td className="px-3 py-2">
                    <Link to={`/drivers/${row.driver._id}`} className="text-blue-600 hover:underline dark:text-blue-400">
                      {row.driver.displayName}
                    </Link>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{formatLapTime(row.bestLapMs)}</td>
                  <td className="px-3 py-2">
                    {row.heat && (
                      <Link to={`/heats/${row.heat.heatNo}`} className="text-blue-600 hover:underline dark:text-blue-400">
                        #{row.heat.heatNo}
                      </Link>
                    )}
                  </td>
                  <td className="px-3 py-2">{row.heat ? formatHeatCategory(row.heat.heatCategory) : "–"}</td>
                  <td className="px-3 py-2">{row.heat ? formatDate(row.heat.raceDateTime) : "–"}</td>
                  <td className="px-3 py-2 tabular-nums">{row.driver.totalLaps}</td>
                </tr>
              ))}
            {mode === "date_range" &&
              dateScoped?.map((row, i) => (
                <tr key={row.entry._id} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="px-3 py-2 tabular-nums">{i + 1}</td>
                  <td className="px-3 py-2">
                    {row.driver && (
                      <Link to={`/drivers/${row.driver._id}`} className="text-blue-600 hover:underline dark:text-blue-400">
                        {row.driver.displayName}
                      </Link>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{formatLapTime(row.entry.bestLapMs)}</td>
                  <td className="px-3 py-2">
                    <Link to={`/heats/${row.entry.heatNo}`} className="text-blue-600 hover:underline dark:text-blue-400">
                      #{row.entry.heatNo}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{formatHeatCategory(row.entry.heatCategory)}</td>
                  <td className="px-3 py-2">{row.heat ? formatDate(row.heat.raceDateTime) : "–"}</td>
                  <td className="px-3 py-2 tabular-nums">{row.driver?.totalLaps ?? "–"}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
