import { useQuery } from "convex/react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { formatDate, formatGap, formatHeatCategory, formatLapTime } from "../lib/format";
import GapFromLeaderChart from "../components/GapFromLeaderChart";

export default function HeatDetailPage() {
  const { heatNo } = useParams();
  const navigate = useNavigate();
  const heatNoNum = Number(heatNo);
  const data = useQuery(api.heats.getByHeatNo, Number.isFinite(heatNoNum) ? { heatNo: heatNoNum } : "skip");

  if (!Number.isFinite(heatNoNum)) {
    return <p className="text-neutral-500">Invalid heat number.</p>;
  }

  if (data === undefined) {
    return <p className="text-neutral-500">Loading heat #{heatNoNum}…</p>;
  }

  if (data === null) {
    return (
      <div className="space-y-2">
        <p className="text-neutral-500">Heat #{heatNoNum} hasn&apos;t been scraped (or doesn&apos;t exist).</p>
        <Link to="/heats" className="text-blue-600 hover:underline dark:text-blue-400">
          Back to heat browser
        </Link>
      </div>
    );
  }

  const { heat, entries } = data;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Heat #{heat.heatNo}</h1>
          <p className="text-neutral-500">
            {formatHeatCategory(heat.heatCategory)} · {heat.rawHeatType} · {formatDate(heat.raceDateTime)}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => navigate(`/heats/${heat.heatNo - 1}`)}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            ← Prev
          </button>
          <button
            onClick={() => navigate(`/heats/${heat.heatNo + 1}`)}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            Next →
          </button>
        </div>
      </div>

      {heat.status === "empty" ? (
        <p className="text-neutral-500">This heat hasn&apos;t been raced yet.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-neutral-500 dark:bg-neutral-900">
                <tr>
                  <th className="px-3 py-2">Pos</th>
                  <th className="px-3 py-2">Driver</th>
                  <th className="px-3 py-2">Kart</th>
                  <th className="px-3 py-2">Best Lap</th>
                  <th className="px-3 py-2">Gap</th>
                  <th className="px-3 py-2">Laps</th>
                  <th className="px-3 py-2">Avg Lap</th>
                  <th className="px-3 py-2">ProSkill</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e._id} className="border-t border-neutral-100 dark:border-neutral-800">
                    <td className="px-3 py-2 tabular-nums">{e.position}</td>
                    <td className="px-3 py-2">
                      {e.driverId ? (
                        <Link to={`/drivers/${e.driverId}`} className="text-blue-600 hover:underline dark:text-blue-400">
                          {e.driverNameRaw}
                        </Link>
                      ) : (
                        <span>{e.teamName ?? e.driverNameRaw}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{e.kartNo ?? "–"}</td>
                    <td className="px-3 py-2 tabular-nums">{formatLapTime(e.bestLapMs)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatGap(e.gapFromLeaderMs)}</td>
                    <td className="px-3 py-2 tabular-nums">{e.numLaps}</td>
                    <td className="px-3 py-2 tabular-nums">{formatLapTime(e.avgLapMs)}</td>
                    <td className="px-3 py-2 tabular-nums">{e.proSkill ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-3">Gap from leader by lap</h2>
            <GapFromLeaderChart entries={entries} />
          </div>
        </>
      )}
    </div>
  );
}
