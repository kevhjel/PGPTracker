import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { formatDate, formatLapTime } from "../lib/format";

type SortKey = "name" | "bestLap" | "heats" | "laps" | "wins" | "podiums" | "lastHeat";
type SortDir = "asc" | "desc";

const COLUMNS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "name", label: "Driver" },
  { key: "bestLap", label: "Best Lap", align: "right" },
  { key: "heats", label: "Heats", align: "right" },
  { key: "laps", label: "Laps", align: "right" },
  { key: "wins", label: "Wins", align: "right" },
  { key: "podiums", label: "Podiums", align: "right" },
  { key: "lastHeat", label: "Last Heat", align: "right" },
];

export default function WatchlistPage() {
  const drivers = useQuery(api.drivers.listWatched);
  const [sortKey, setSortKey] = useState<SortKey>("bestLap");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : key === "bestLap" ? "asc" : "desc");
    }
  }

  const sorted = useMemo(() => {
    if (!drivers) return [];
    const withDefaults = drivers.map((d) => ({
      ...d,
      totalWins: d.totalWins ?? 0,
      totalPodiums: d.totalPodiums ?? 0,
    }));
    const dir = sortDir === "asc" ? 1 : -1;
    return [...withDefaults].sort((a, b) => {
      switch (sortKey) {
        case "name":
          return dir * a.displayName.localeCompare(b.displayName);
        case "bestLap": {
          const av = a.bestLapMs ?? Infinity;
          const bv = b.bestLapMs ?? Infinity;
          return dir * (av - bv);
        }
        case "heats":
          return dir * (a.totalHeats - b.totalHeats);
        case "laps":
          return dir * (a.totalLaps - b.totalLaps);
        case "wins":
          return dir * (a.totalWins - b.totalWins);
        case "podiums":
          return dir * (a.totalPodiums - b.totalPodiums);
        case "lastHeat": {
          const av = a.lastHeatDate ?? -Infinity;
          const bv = b.lastHeatDate ?? -Infinity;
          return dir * (av - bv);
        }
      }
    });
  }, [drivers, sortKey, sortDir]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Watchlist</h1>
      <p className="text-neutral-500">
        Drivers followed for quick reference. Every driver
        is tracked and scraped regardless of watchlist status.
      </p>

      {drivers?.length === 0 && <p className="text-neutral-500">No drivers on the watchlist yet.</p>}

      {drivers && drivers.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-neutral-500 dark:bg-neutral-900">
              <tr>
                {COLUMNS.map((col) => (
                  <th key={col.key} className={`px-3 py-2 ${col.align === "right" ? "text-right" : ""}`}>
                    <button
                      onClick={() => toggleSort(col.key)}
                      className="inline-flex items-center gap-1 hover:text-neutral-900 dark:hover:text-neutral-100"
                    >
                      {col.label}
                      {sortKey === col.key && <span>{sortDir === "asc" ? "▲" : "▼"}</span>}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((driver) => (
                <tr key={driver._id} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="px-3 py-2">
                    <Link
                      to={`/drivers/${driver._id}`}
                      className="text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {driver.displayName}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatLapTime(driver.bestLapMs)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{driver.totalHeats}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{driver.totalLaps}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{driver.totalWins}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{driver.totalPodiums}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {driver.lastSeenHeatNo ? (
                      <Link
                        to={`/heats/${driver.lastSeenHeatNo}`}
                        className="text-blue-600 hover:underline dark:text-blue-400"
                      >
                        {formatDate(driver.lastHeatDate)} (#{driver.lastSeenHeatNo})
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
