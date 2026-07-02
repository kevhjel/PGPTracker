import { useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { formatLapTime } from "../lib/format";

export default function WatchlistPage() {
  const drivers = useQuery(api.drivers.listWatched);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Watchlist</h1>
      <p className="text-neutral-500">
        Drivers followed for quick reference. This is a query-time filter over the full dataset — every driver
        is tracked and scraped regardless of watchlist status.
      </p>

      {drivers?.length === 0 && <p className="text-neutral-500">No drivers on the watchlist yet.</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {drivers?.map((driver) => (
          <Link
            key={driver._id}
            to={`/drivers/${driver._id}`}
            className="rounded-lg border border-neutral-200 p-4 hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600"
          >
            <div className="font-semibold">{driver.displayName}</div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-sm text-neutral-500">
              <div>
                <div className="tabular-nums text-neutral-900 dark:text-neutral-100">{driver.totalHeats}</div>
                Heats
              </div>
              <div>
                <div className="tabular-nums text-neutral-900 dark:text-neutral-100">{driver.totalLaps}</div>
                Laps
              </div>
              <div>
                <div className="tabular-nums text-neutral-900 dark:text-neutral-100">{formatLapTime(driver.bestLapMs)}</div>
                PB
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
