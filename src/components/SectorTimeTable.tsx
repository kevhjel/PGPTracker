import { formatLapTime } from "../lib/format";

interface SectorLap {
  lapIndex: number;
  projection?: { sectorTimes: number[] } | null;
}

/** Lap x sector grid with the best (minimum) time per sector highlighted, plus a synthetic "Ideal" row summing those minimums. */
export default function SectorTimeTable({
  sectorCount,
  laps,
}: {
  sectorCount: number;
  laps: SectorLap[];
}) {
  const withProjection = laps.filter((l) => l.projection);
  if (withProjection.length === 0) {
    return <p className="text-sm text-neutral-500">No projected laps to compare.</p>;
  }

  const idealTimes = Array.from({ length: sectorCount }, (_, i) => {
    const values = withProjection
      .map((l) => l.projection!.sectorTimes[i])
      .filter((t): t is number => Number.isFinite(t));
    return values.length > 0 ? Math.min(...values) : NaN;
  });
  const idealTotal = idealTimes.reduce((sum, t) => sum + (Number.isFinite(t) ? t : 0), 0);

  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 text-left text-neutral-500 dark:bg-neutral-900">
          <tr>
            <th className="px-3 py-2">Lap</th>
            {idealTimes.map((_, i) => (
              <th key={i} className="px-3 py-2 tabular-nums">
                S{i + 1}
              </th>
            ))}
            <th className="px-3 py-2">Total</th>
          </tr>
        </thead>
        <tbody>
          {withProjection.map((lap) => {
            const sectorTimes = lap.projection!.sectorTimes;
            const total = sectorTimes.reduce((sum, t) => sum + (Number.isFinite(t) ? t : 0), 0);
            return (
              <tr key={lap.lapIndex} className="border-t border-neutral-100 dark:border-neutral-800">
                <td className="px-3 py-2">Lap {lap.lapIndex + 1}</td>
                {idealTimes.map((ideal, i) => {
                  const t = sectorTimes[i];
                  const isBest = Number.isFinite(t) && t === ideal;
                  return (
                    <td
                      key={i}
                      className="px-3 py-2 tabular-nums"
                      style={isBest ? { color: "var(--series-2)", fontWeight: 600 } : undefined}
                    >
                      {Number.isFinite(t) ? formatLapTime(t) : "–"}
                    </td>
                  );
                })}
                <td className="px-3 py-2 tabular-nums">{formatLapTime(total)}</td>
              </tr>
            );
          })}
          <tr className="border-t border-neutral-200 font-semibold dark:border-neutral-700">
            <td className="px-3 py-2">Ideal</td>
            {idealTimes.map((t, i) => (
              <td key={i} className="px-3 py-2 tabular-nums">
                {Number.isFinite(t) ? formatLapTime(t) : "–"}
              </td>
            ))}
            <td className="px-3 py-2 tabular-nums">{formatLapTime(idealTotal)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
