import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useAdminSecret } from "../lib/adminSecret";
import { formatDate, formatLapTime } from "../lib/format";
import GpxUploadControl from "../components/GpxUploadControl";
import TrackBoundsUploadControl from "../components/TrackBoundsUploadControl";
import TrackBoundsPreview from "../components/TrackBoundsPreview";

const STATUS_LABEL: Record<string, string> = {
  pending: "Parsing…",
  parsed: "Parsed",
  error: "Error",
};

export default function TelemetryPage() {
  const { secret } = useAdminSecret();
  const [selectedSessionId, setSelectedSessionId] = useState<Id<"gpsSessions"> | null>(null);

  const sessions = useQuery(api.gps.listSessions, secret ? { adminSecret: secret } : "skip");
  const trackBounds = useQuery(api.gps.getTrackBounds, secret ? { adminSecret: secret } : "skip");
  const activeReference = useQuery(api.gps.getActiveTrackReference, secret ? { adminSecret: secret } : "skip");
  const laps = useQuery(
    api.gps.listLaps,
    secret && selectedSessionId ? { sessionId: selectedSessionId, adminSecret: secret } : "skip",
  );
  const buildTrackReferenceFromLap = useMutation(api.gps.buildTrackReferenceFromLap);
  const [referenceMessage, setReferenceMessage] = useState("");
  const [referenceBusyLapId, setReferenceBusyLapId] = useState<Id<"gpsLaps"> | null>(null);

  async function handleSetReference(lapId: Id<"gpsLaps">) {
    if (!secret) return;
    setReferenceBusyLapId(lapId);
    setReferenceMessage("");
    try {
      const result = await buildTrackReferenceFromLap({ lapId, adminSecret: secret });
      setReferenceMessage(
        `Built track reference with ${result.sectorCount} sectors${
          result.usedFallbackSectors ? " (corner detection was inconclusive, fell back to even-distance sectors)" : ""
        }.`,
      );
    } catch (err) {
      setReferenceMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setReferenceBusyLapId(null);
    }
  }

  if (!secret) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Telemetry</h1>
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
      <h1 className="text-2xl font-bold">Telemetry</h1>
      <GpxUploadControl adminSecret={secret} />

      <div>
        <h2 className="text-lg font-semibold mb-3">Track bounds</h2>
        <TrackBoundsUploadControl adminSecret={secret} />
        {(trackBounds || activeReference) && (
          <div className="mt-3">
            <TrackBoundsPreview
              outline={trackBounds?.outline ?? undefined}
              innerEdge={trackBounds?.innerEdge ?? undefined}
              outerEdge={trackBounds?.outerEdge ?? undefined}
              referenceLine={activeReference?.polyline}
            />
          </div>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Track reference</h2>
        {referenceMessage && <p className="mb-3 text-sm text-neutral-500">{referenceMessage}</p>}
        {!activeReference && <p className="text-neutral-500">No track reference yet — pick a clean lap below.</p>}
        {activeReference && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
                <div className="text-2xl font-bold tabular-nums">{activeReference.totalDistanceM.toFixed(0)}m</div>
                <div className="text-sm text-neutral-500">Track length</div>
              </div>
              <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
                <div className="text-2xl font-bold tabular-nums">{activeReference.sectors.length}</div>
                <div className="text-sm text-neutral-500">Sectors</div>
              </div>
            </div>
            <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-left text-neutral-500 dark:bg-neutral-900">
                  <tr>
                    <th className="px-3 py-2">Sector</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Start (m)</th>
                    <th className="px-3 py-2">End (m)</th>
                    <th className="px-3 py-2">Length (m)</th>
                  </tr>
                </thead>
                <tbody>
                  {activeReference.sectors.map((s) => (
                    <tr key={s.index} className="border-t border-neutral-100 dark:border-neutral-800">
                      <td className="px-3 py-2 tabular-nums">{s.index + 1}</td>
                      <td className="px-3 py-2 capitalize">{s.type}</td>
                      <td className="px-3 py-2 tabular-nums">{s.startDistM.toFixed(0)}</td>
                      <td className="px-3 py-2 tabular-nums">{s.endDistM.toFixed(0)}</td>
                      <td className="px-3 py-2 tabular-nums">{(s.endDistM - s.startDistM).toFixed(0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Uploaded sessions</h2>
        {sessions === undefined && <p className="text-neutral-500">Loading…</p>}
        {sessions?.length === 0 && <p className="text-neutral-500">No GPX files uploaded yet.</p>}
        {sessions !== undefined && sessions.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-neutral-500 dark:bg-neutral-900">
                <tr>
                  <th className="px-3 py-2">File</th>
                  <th className="px-3 py-2">Uploaded</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Laps</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr
                    key={s._id}
                    onClick={() => setSelectedSessionId(s._id)}
                    className={`cursor-pointer border-t border-neutral-100 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900 ${
                      selectedSessionId === s._id ? "bg-neutral-50 dark:bg-neutral-900" : ""
                    }`}
                  >
                    <td className="px-3 py-2">{s.fileName}</td>
                    <td className="px-3 py-2">{formatDate(s.uploadedAt)}</td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          s.status === "error"
                            ? "text-red-600 dark:text-red-400"
                            : s.status === "parsed"
                              ? undefined
                              : "text-neutral-500"
                        }
                      >
                        {STATUS_LABEL[s.status]}
                      </span>
                      {s.status === "error" && s.errorMessage && (
                        <span className="ml-2 text-xs text-neutral-500">{s.errorMessage}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{s.lapCount ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedSessionId && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Laps</h2>
          {laps === undefined && <p className="text-neutral-500">Loading…</p>}
          {laps?.length === 0 && <p className="text-neutral-500">No laps in this session.</p>}
          {laps !== undefined && laps.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-left text-neutral-500 dark:bg-neutral-900">
                  <tr>
                    <th className="px-3 py-2">Lap</th>
                    <th className="px-3 py-2">Source</th>
                    <th className="px-3 py-2">Start</th>
                    <th className="px-3 py-2">Duration</th>
                    <th className="px-3 py-2">Refined</th>
                    <th className="px-3 py-2">Points</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {laps.map((lap) => (
                    <tr key={lap._id} className="border-t border-neutral-100 dark:border-neutral-800">
                      <td className="px-3 py-2 tabular-nums">{lap.lapIndex + 1}</td>
                      <td className="px-3 py-2">
                        {lap.source === "trkseg"
                          ? "Watch lap"
                          : lap.source === "self_crossing"
                            ? "Auto-detected"
                            : "Reference-aligned"}
                      </td>
                      <td className="px-3 py-2">{formatDate(lap.startTime)}</td>
                      <td className="px-3 py-2 tabular-nums">{formatLapTime(lap.durationMs)}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {lap.projection?.lapTimeMsRefined !== undefined
                          ? formatLapTime(lap.projection.lapTimeMsRefined)
                          : "–"}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{lap.points.length}</td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => handleSetReference(lap._id)}
                          disabled={referenceBusyLapId === lap._id}
                          className="rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                        >
                          {referenceBusyLapId === lap._id ? "Building…" : "Set as track reference"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
