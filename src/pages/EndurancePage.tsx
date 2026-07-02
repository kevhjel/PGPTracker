import { useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { formatDate, formatLapTime } from "../lib/format";

export default function EndurancePage() {
  const podiums = useQuery(api.heats.listEndurancePodiums, { limit: 50 });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Endurance Races</h1>

      {podiums?.length === 0 && <p className="text-neutral-500">No endurance heats scraped yet.</p>}

      <div className="space-y-4">
        {podiums?.map(({ heat, podium }) => (
          <div key={heat._id} className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
            <div className="flex items-center justify-between mb-3">
              <Link to={`/heats/${heat.heatNo}`} className="font-semibold text-blue-600 hover:underline dark:text-blue-400">
                Heat #{heat.heatNo}
              </Link>
              <span className="text-sm text-neutral-500">{formatDate(heat.raceDateTime)}</span>
            </div>
            <ol className="space-y-1 text-sm">
              {podium.map((entry, i) => (
                <li key={entry._id} className="flex justify-between">
                  <span>
                    {["🥇", "🥈", "🥉"][i] ?? `${i + 1}.`} {entry.teamName ?? entry.driverNameRaw}
                  </span>
                  <span className="tabular-nums text-neutral-500">{formatLapTime(entry.bestLapMs)}</span>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </div>
  );
}
