import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { formatLapTime } from "../lib/format";

const DEBOUNCE_MS = 200;

export default function DriverSearchPage() {
  const [input, setInput] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(input), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);

  const results = useQuery(api.drivers.search, { text: debounced });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Find a Driver</h1>
      <p className="text-neutral-500">Search by name (or exact ClubSpeed CustID) to jump to any driver&apos;s profile.</p>

      <input
        type="text"
        autoFocus
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Start typing a driver's name…"
        className="w-full rounded-md border border-neutral-300 px-3 py-2 text-base dark:border-neutral-700 dark:bg-neutral-900"
      />

      {debounced && (
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-100 dark:divide-neutral-800">
          {results === undefined && <p className="p-4 text-sm text-neutral-500">Searching…</p>}
          {results?.length === 0 && <p className="p-4 text-sm text-neutral-500">No drivers found.</p>}
          {results?.map((driver) => (
            <Link
              key={driver._id}
              to={`/drivers/${driver._id}`}
              className="flex items-center justify-between px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-900"
            >
              <div>
                <div className="font-medium">{driver.displayName}</div>
                <div className="text-sm text-neutral-500">
                  {driver.totalHeats} {driver.totalHeats === 1 ? "heat" : "heats"}
                </div>
              </div>
              <div className="text-sm tabular-nums text-neutral-500">{formatLapTime(driver.bestLapMs)}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
