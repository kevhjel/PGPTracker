import { useState } from "react";
import { useQuery } from "convex/react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { formatDate, formatHeatCategory } from "../lib/format";

const CATEGORIES = [
  "arrive_and_drive",
  "league",
  "pro_am",
  "group_event",
  "practice",
  "endurance",
  "other",
] as const;

export default function HeatBrowserPage() {
  const [jumpTo, setJumpTo] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number] | null>(null);
  const navigate = useNavigate();

  const recent = useQuery(api.heats.listRecent, category ? "skip" : { limit: 50 });
  const byCategory = useQuery(api.heats.listByCategory, category ? { category, limit: 50 } : "skip");
  const heats = category ? byCategory : recent;

  const handleJump = (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseInt(jumpTo, 10);
    if (Number.isFinite(n)) navigate(`/heats/${n}`);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Heat Browser</h1>

      <form onSubmit={handleJump} className="flex gap-2">
        <input
          type="number"
          value={jumpTo}
          onChange={(e) => setJumpTo(e.target.value)}
          placeholder="Jump to heat number…"
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          type="submit"
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
        >
          Go
        </button>
      </form>

      <div className="flex flex-wrap gap-1">
        <button
          onClick={() => setCategory(null)}
          className={`rounded-md px-3 py-1.5 text-sm ${!category ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "border border-neutral-300 dark:border-neutral-700"}`}
        >
          Recent
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`rounded-md px-3 py-1.5 text-sm ${category === c ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "border border-neutral-300 dark:border-neutral-700"}`}
          >
            {formatHeatCategory(c)}
          </button>
        ))}
      </div>

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
            {heats?.map((heat) => (
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
            {heats?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-neutral-500">
                  No heats found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
