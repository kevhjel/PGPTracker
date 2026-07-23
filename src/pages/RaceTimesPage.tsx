import { useMemo, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import { useAdminSecret } from "../lib/adminSecret";
import RaceTimesHistogramChart from "../components/RaceTimesHistogramChart";

// Wednesday -> Sunday, left to right, per the request (Mon/Tue are closed).
const DAY_ORDER = [3, 4, 5, 6, 0];
const DAY_LABELS: Record<number, string> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

function formatTimeLabel(slotStartMinute: number): string {
  const hour = Math.floor(slotStartMinute / 60);
  const minute = slotStartMinute % 60;
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${minute.toString().padStart(2, "0")}${hour < 12 ? "am" : "pm"}`;
}

export default function RaceTimesPage() {
  const { secret } = useAdminSecret();
  const [selectedWeek, setSelectedWeek] = useState<{ isoYear: number; isoWeek: number } | null>(null);
  const [recomputing, setRecomputing] = useState(false);
  const [recomputeMessage, setRecomputeMessage] = useState("");

  const weeklyHours = useQuery(api.raceTimes.getWeeklyHours, {});
  const weeks = useQuery(api.raceTimes.listAvailableWeeks, secret ? { adminSecret: secret } : "skip");
  const buckets = useQuery(
    api.raceTimes.getRaceTimeBuckets,
    secret
      ? {
          adminSecret: secret,
          ...(selectedWeek ? { isoYear: selectedWeek.isoYear, isoWeek: selectedWeek.isoWeek } : {}),
        }
      : "skip",
  );
  const recomputeNow = useAction(api.raceTimes.adminRecomputeNow);

  const slots = useMemo(() => {
    if (!weeklyHours) return [];
    return DAY_ORDER.flatMap((weekday) => {
      const window = weeklyHours[weekday];
      if (!window) return [];
      const result: { weekday: number; slotStartMinute: number }[] = [];
      for (let m = window.openHour * 60; m < window.closeHour * 60; m += 15) {
        result.push({ weekday, slotStartMinute: m });
      }
      return result;
    });
  }, [weeklyHours]);

  const chartData = useMemo(() => {
    const byKey = new Map((buckets ?? []).map((b) => [`${b.weekday}-${b.slotStartMinute}`, b]));
    return slots.map((s) => {
      const row = byKey.get(`${s.weekday}-${s.slotStartMinute}`);
      const avgEntries = row && row.heatCount > 0 ? row.totalEntries / row.heatCount : 0;
      return {
        key: `${s.weekday}-${s.slotStartMinute}`,
        weekday: s.weekday,
        dayLabel: DAY_LABELS[s.weekday],
        timeLabel: formatTimeLabel(s.slotStartMinute),
        avgEntries,
        heatCount: row?.heatCount ?? 0,
      };
    });
  }, [slots, buckets]);

  async function handleRecompute() {
    if (!secret) return;
    setRecomputing(true);
    setRecomputeMessage("");
    try {
      await recomputeNow({ adminSecret: secret });
      setRecomputeMessage("Recompute finished.");
    } catch (err) {
      setRecomputeMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRecomputing(false);
    }
  }

  if (!secret) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Race Times</h1>
        <p className="text-neutral-500">
          This page is admin-only.{" "}
          <Link to="/admin/scrape-health" className="text-blue-600 hover:underline dark:text-blue-400">
            Enter the admin key
          </Link>{" "}
          to continue.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Race Times</h1>
        <button
          onClick={handleRecompute}
          disabled={recomputing}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-neutral-700"
        >
          {recomputing ? "Recomputing…" : "Recompute now"}
        </button>
      </div>
      {recomputeMessage && <p className="text-sm text-neutral-500">{recomputeMessage}</p>}

      <p className="text-sm text-neutral-500">
        Average drivers per heat, arrive-and-drive heats only, by day and 15-minute time slot. Rebuilt nightly; use
        "Recompute now" to refresh immediately after touching historical data.
      </p>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="race-times-week">Week:</label>
        <select
          id="race-times-week"
          className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700"
          value={selectedWeek ? `${selectedWeek.isoYear}-${selectedWeek.isoWeek}` : "all"}
          onChange={(e) => {
            if (e.target.value === "all") {
              setSelectedWeek(null);
              return;
            }
            const [isoYear, isoWeek] = e.target.value.split("-").map(Number);
            setSelectedWeek({ isoYear, isoWeek });
          }}
        >
          <option value="all">All time</option>
          {(weeks ?? []).map((w) => (
            <option key={`${w.isoYear}-${w.isoWeek}`} value={`${w.isoYear}-${w.isoWeek}`}>
              Week of{" "}
              {new Date(w.weekStartMs).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </option>
          ))}
        </select>
      </div>

      {buckets === undefined || weeklyHours === undefined ? (
        <p className="text-neutral-500">Loading…</p>
      ) : (
        <RaceTimesHistogramChart data={chartData} dayOrder={DAY_ORDER} />
      )}
    </div>
  );
}
