import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { formatDate, formatGap, formatHeatCategory, formatLapTime } from "../lib/format";
import GapFromLeaderChart from "../components/GapFromLeaderChart";
import LapTimesChart from "../components/LapTimesChart";
import WetBadge from "../components/WetBadge";
import { seriesColor } from "../lib/chartColors";
import { useAdminSecret } from "../lib/adminSecret";

export default function HeatDetailPage() {
  const { heatNo } = useParams();
  const navigate = useNavigate();
  const heatNoNum = Number(heatNo);
  const data = useQuery(api.heats.getByHeatNo, Number.isFinite(heatNoNum) ? { heatNo: heatNoNum } : "skip");
  const { secret } = useAdminSecret();
  const setWetnessOverride = useMutation(api.heats.setWetnessOverride);
  const clearWetnessOverride = useMutation(api.heats.clearWetnessOverride);
  const [wetnessMessage, setWetnessMessage] = useState("");

  const driversWithLaps = useMemo(
    () => (data ? data.entries.filter((e) => e.laps.length > 0).map((e) => e.driverNameRaw) : []),
    [data],
  );
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const selectedOrder = driversWithLaps.filter((name) => !deselected.has(name));
  const selectedNames = new Set(selectedOrder);

  function toggleDriver(name: string) {
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

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
          <p className="flex flex-wrap items-center gap-2 text-neutral-500">
            <span>
              {formatHeatCategory(heat.heatCategory)} · {heat.rawHeatType} · {formatDate(heat.raceDateTime)}
            </span>
            {heat.isWet && <WetBadge ratio={heat.wetnessRatio} />}
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

      {secret && heat.status !== "empty" && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-neutral-500">
            Wet conditions ({heat.wetnessSource === "admin" ? "admin-set" : "auto"}):
          </span>
          <button
            onClick={async () => {
              setWetnessMessage("");
              try {
                await setWetnessOverride({ heatId: heat._id, isWet: true, adminSecret: secret });
              } catch (err) {
                setWetnessMessage(String(err));
              }
            }}
            className="rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            Mark wet
          </button>
          <button
            onClick={async () => {
              setWetnessMessage("");
              try {
                await setWetnessOverride({ heatId: heat._id, isWet: false, adminSecret: secret });
              } catch (err) {
                setWetnessMessage(String(err));
              }
            }}
            className="rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            Mark dry
          </button>
          {heat.wetnessSource === "admin" && (
            <button
              onClick={async () => {
                setWetnessMessage("");
                try {
                  await clearWetnessOverride({ heatId: heat._id, adminSecret: secret });
                } catch (err) {
                  setWetnessMessage(String(err));
                }
              }}
              className="rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              Reset to auto
            </button>
          )}
          {wetnessMessage && <span className="text-red-600 dark:text-red-400">{wetnessMessage}</span>}
        </div>
      )}

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

          {driversWithLaps.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-neutral-500">Drivers:</span>
              {driversWithLaps.map((name) => {
                const colorIndex = selectedOrder.indexOf(name);
                const isSelected = colorIndex !== -1;
                const color = isSelected && colorIndex < 8 ? seriesColor(colorIndex) : undefined;
                return (
                  <button
                    key={name}
                    onClick={() => toggleDriver(name)}
                    className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors"
                    style={
                      isSelected
                        ? { borderColor: color ?? "var(--chart-muted)", color: color ?? "var(--chart-muted)" }
                        : { borderColor: "var(--chart-gridline)", color: "var(--chart-muted)" }
                    }
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: isSelected ? (color ?? "var(--chart-muted)") : "transparent", border: isSelected ? "none" : "1px solid var(--chart-muted)" }}
                    />
                    {name}
                  </button>
                );
              })}
              {deselected.size > 0 && (
                <button
                  onClick={() => setDeselected(new Set())}
                  className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                >
                  Show all
                </button>
              )}
            </div>
          )}

          <div>
            <h2 className="text-lg font-semibold mb-3">Gap from leader by lap</h2>
            <GapFromLeaderChart entries={entries} selectedNames={selectedNames} />
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-3">Lap times</h2>
            <LapTimesChart entries={entries} selectedNames={selectedNames} />
          </div>
        </>
      )}
    </div>
  );
}
