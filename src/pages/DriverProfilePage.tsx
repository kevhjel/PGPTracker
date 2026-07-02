import { useQuery, usePaginatedQuery } from "convex/react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { formatDate, formatHeatCategory, formatLapTime } from "../lib/format";

export default function DriverProfilePage() {
  const { driverId } = useParams();
  const id = driverId as Id<"drivers">;
  const driver = useQuery(api.drivers.getById, { driverId: id });
  const { results, status, loadMore } = usePaginatedQuery(
    api.heats.listEntriesByDriver,
    { driverId: id },
    { initialNumItems: 25 },
  );

  if (driver === undefined) return <p className="text-neutral-500">Loading…</p>;
  if (driver === null) return <p className="text-neutral-500">Driver not found.</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{driver.displayName}</h1>
          {driver.nameVariantsSeen.length > 1 && (
            <p className="text-sm text-neutral-500">
              Also seen as: {driver.nameVariantsSeen.filter((n) => n !== driver.displayName).join(", ")}
            </p>
          )}
        </div>
        <Link
          to={`/drivers/${id}/analytics`}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
        >
          View analytics →
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="text-2xl font-bold tabular-nums">{driver.totalHeats}</div>
          <div className="text-sm text-neutral-500">Heats</div>
        </div>
        <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="text-2xl font-bold tabular-nums">{driver.totalLaps}</div>
          <div className="text-sm text-neutral-500">Laps</div>
        </div>
        <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="text-2xl font-bold tabular-nums">{formatLapTime(driver.bestLapMs)}</div>
          <div className="text-sm text-neutral-500">Personal best</div>
        </div>
        <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="text-2xl font-bold tabular-nums">
            #{driver.firstSeenHeatNo}–#{driver.lastSeenHeatNo}
          </div>
          <div className="text-sm text-neutral-500">Heat range</div>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Heat history</h2>
        <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-neutral-500 dark:bg-neutral-900">
              <tr>
                <th className="px-3 py-2">Heat</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Pos</th>
                <th className="px-3 py-2">Kart</th>
                <th className="px-3 py-2">Best Lap</th>
                <th className="px-3 py-2">Laps</th>
              </tr>
            </thead>
            <tbody>
              {results.map(({ entry, heat }) => (
                <tr key={entry._id} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="px-3 py-2">
                    <Link to={`/heats/${entry.heatNo}`} className="text-blue-600 hover:underline dark:text-blue-400">
                      #{entry.heatNo}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{heat ? formatHeatCategory(heat.heatCategory) : "–"}</td>
                  <td className="px-3 py-2">{heat ? formatDate(heat.raceDateTime) : "–"}</td>
                  <td className="px-3 py-2 tabular-nums">{entry.position}</td>
                  <td className="px-3 py-2 tabular-nums">{entry.kartNo ?? "–"}</td>
                  <td className="px-3 py-2 tabular-nums">{formatLapTime(entry.bestLapMs)}</td>
                  <td className="px-3 py-2 tabular-nums">{entry.numLaps}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {status === "CanLoadMore" && (
          <button
            onClick={() => loadMore(25)}
            className="mt-3 rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            Load more
          </button>
        )}
      </div>
    </div>
  );
}
