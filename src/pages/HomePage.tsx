import { useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { formatDate, formatHeatCategory } from "../lib/format";

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-sm text-neutral-500">{label}</div>
    </div>
  );
}

export default function HomePage() {
  const stats = useQuery(api.appSettings.stats);
  const recentHeats = useQuery(api.heats.listRecent, { limit: 20 });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold mb-1">PGP Kent Race History</h1>
        <p className="text-neutral-500">
          Every heat, every lap, scraped from PGP Kent&apos;s ClubSpeed timing system.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Heats scraped" value={stats ? stats.totalHeatsScraped.toLocaleString() : "…"} />
        <StatTile label="Drivers" value={stats ? stats.totalDrivers.toLocaleString() : "…"} />
        <StatTile label="Laps recorded" value={stats ? stats.totalLaps.toLocaleString() : "…"} />
        <StatTile
          label="Date range"
          value={stats?.minHeatDate ? `${formatDate(stats.minHeatDate).split(",")[0]} – ${formatDate(stats.maxHeatDate).split(",")[0]}` : "…"}
        />
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Recent heats</h2>
        <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-neutral-500 dark:bg-neutral-900">
              <tr>
                <th className="px-3 py-2">Heat</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Winner</th>
                <th className="px-3 py-2">Entries</th>
              </tr>
            </thead>
            <tbody>
              {recentHeats?.map((heat) => (
                <tr key={heat._id} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="px-3 py-2">
                    <Link to={`/heats/${heat.heatNo}`} className="text-blue-600 hover:underline dark:text-blue-400">
                      #{heat.heatNo}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{formatHeatCategory(heat.heatCategory)}</td>
                  <td className="px-3 py-2">{formatDate(heat.raceDateTime)}</td>
                  <td className="px-3 py-2">{heat.status === "empty" ? "Not yet raced" : heat.winnerRaw}</td>
                  <td className="px-3 py-2">{heat.numEntries}</td>
                </tr>
              ))}
              {recentHeats?.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-neutral-500">
                    No heats scraped yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
