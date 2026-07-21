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
import LapPlaybackView from "../components/LapPlaybackView";
import DeltaTraceChart from "../components/DeltaTraceChart";
import SectorTimeTable from "../components/SectorTimeTable";

const STATUS_LABEL: Record<string, string> = {
  pending: "Parsing…",
  parsed: "Parsed",
  error: "Error",
};

type ComparisonTab = "playback" | "delta" | "sectors";

export default function TelemetryPage() {
  const { secret } = useAdminSecret();
  const [selectedSessionId, setSelectedSessionId] = useState<Id<"gpsSessions"> | null>(null);
  const [selectedLapIds, setSelectedLapIds] = useState<Set<Id<"gpsLaps">>>(new Set());
  const [comparisonTab, setComparisonTab] = useState<ComparisonTab>("playback");

  const sessions = useQuery(api.gps.listSessions, secret ? { adminSecret: secret } : "skip");
  const trackBounds = useQuery(api.gps.getTrackBounds, secret ? { adminSecret: secret } : "skip");
  const trackOrigin = useQuery(api.gps.getTrackOrigin, secret ? { adminSecret: secret } : "skip");
  const activeReference = useQuery(api.gps.getActiveTrackReference, secret ? { adminSecret: secret } : "skip");
  const laps = useQuery(
    api.gps.listLaps,
    secret && selectedSessionId ? { sessionId: selectedSessionId, adminSecret: secret } : "skip",
  );

  const buildTrackReferenceFromLap = useMutation(api.gps.buildTrackReferenceFromLap);
  const deleteSession = useMutation(api.gps.deleteSession);
  const deleteAllSessions = useMutation(api.gps.deleteAllSessions);
  const deleteAllTrackBounds = useMutation(api.gps.deleteAllTrackBounds);
  const deleteAllTrackReferences = useMutation(api.gps.deleteAllTrackReferences);

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

  function toggleLapSelection(lapId: Id<"gpsLaps">) {
    setSelectedLapIds((prev) => {
      const next = new Set(prev);
      if (next.has(lapId)) next.delete(lapId);
      else next.add(lapId);
      return next;
    });
  }

  async function handleDeleteSession(sessionId: Id<"gpsSessions">) {
    if (!secret) return;
    if (!confirm("Delete this uploaded session and all its laps? This can't be undone.")) return;
    await deleteSession({ sessionId, adminSecret: secret });
    if (selectedSessionId === sessionId) setSelectedSessionId(null);
  }

  async function handleDeleteAllSessions() {
    if (!secret) return;
    if (!confirm("Delete every uploaded session and lap? This can't be undone.")) return;
    await deleteAllSessions({ adminSecret: secret });
    setSelectedSessionId(null);
    setSelectedLapIds(new Set());
  }

  async function handleClearBounds() {
    if (!secret) return;
    if (!confirm("Remove the track bounds shape?")) return;
    await deleteAllTrackBounds({ adminSecret: secret });
  }

  async function handleClearReference() {
    if (!secret) return;
    if (!confirm("Remove the track reference? Every lap's sector times and delta data will be cleared until a new one is built.")) return;
    await deleteAllTrackReferences({ adminSecret: secret });
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

  const selectedLaps = (laps ?? []).filter((l) => selectedLapIds.has(l._id)).sort((a, b) => a.lapIndex - b.lapIndex);
  const [baseLap, ...compareLaps] = selectedLaps;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Telemetry</h1>
      <GpxUploadControl adminSecret={secret} />

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Track bounds</h2>
          {trackBounds && (
            <button onClick={handleClearBounds} className="text-xs text-red-600 hover:underline dark:text-red-400">
              Clear bounds
            </button>
          )}
        </div>
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
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Track reference</h2>
          {activeReference && (
            <button onClick={handleClearReference} className="text-xs text-red-600 hover:underline dark:text-red-400">
              Clear reference
            </button>
          )}
        </div>
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
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Uploaded sessions</h2>
          {sessions !== undefined && sessions.length > 0 && (
            <button onClick={handleDeleteAllSessions} className="text-xs text-red-600 hover:underline dark:text-red-400">
              Delete all
            </button>
          )}
        </div>
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
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr
                    key={s._id}
                    className={`border-t border-neutral-100 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900 ${
                      selectedSessionId === s._id ? "bg-neutral-50 dark:bg-neutral-900" : ""
                    }`}
                  >
                    <td className="cursor-pointer px-3 py-2" onClick={() => setSelectedSessionId(s._id)}>
                      {s.fileName}
                    </td>
                    <td className="cursor-pointer px-3 py-2" onClick={() => setSelectedSessionId(s._id)}>
                      {formatDate(s.uploadedAt)}
                    </td>
                    <td className="cursor-pointer px-3 py-2" onClick={() => setSelectedSessionId(s._id)}>
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
                    <td className="cursor-pointer px-3 py-2 tabular-nums" onClick={() => setSelectedSessionId(s._id)}>
                      {s.lapCount ?? "–"}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => handleDeleteSession(s._id)}
                        className="text-xs text-red-600 hover:underline dark:text-red-400"
                      >
                        Delete
                      </button>
                    </td>
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
          <p className="mb-3 text-sm text-neutral-500">Select laps below to play them back or compare deltas/sectors.</p>
          {laps === undefined && <p className="text-neutral-500">Loading…</p>}
          {laps?.length === 0 && <p className="text-neutral-500">No laps in this session.</p>}
          {laps !== undefined && laps.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-left text-neutral-500 dark:bg-neutral-900">
                  <tr>
                    <th className="px-3 py-2"></th>
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
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selectedLapIds.has(lap._id)}
                          onChange={() => toggleLapSelection(lap._id)}
                        />
                      </td>
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

      {selectedLaps.length > 0 && (
        <div>
          <div className="mb-3 flex flex-wrap gap-2">
            {(["playback", "delta", "sectors"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setComparisonTab(tab)}
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  comparisonTab === tab
                    ? "border-transparent bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "border-neutral-300 dark:border-neutral-700"
                }`}
              >
                {tab === "playback" ? "Playback" : tab === "delta" ? "Delta trace" : "Sectors"}
              </button>
            ))}
          </div>

          {comparisonTab === "playback" &&
            (trackOrigin ? (
              <LapPlaybackView
                laps={selectedLaps}
                originLat={trackOrigin.lat}
                originLon={trackOrigin.lon}
                outline={trackBounds?.outline ?? undefined}
                innerEdge={trackBounds?.innerEdge ?? undefined}
                outerEdge={trackBounds?.outerEdge ?? undefined}
                referenceLine={activeReference?.polyline}
              />
            ) : (
              <p className="text-sm text-neutral-500">Upload track bounds or build a track reference first.</p>
            ))}

          {comparisonTab === "delta" &&
            (baseLap && compareLaps.length > 0 && activeReference ? (
              <>
                <p className="mb-3 text-sm text-neutral-500">
                  Comparing against Lap {baseLap.lapIndex + 1} (positive = losing time, negative = gaining).
                </p>
                <DeltaTraceChart
                  referenceDistances={activeReference.polyline.map((p) => p.distM)}
                  baseLap={baseLap}
                  compareLaps={compareLaps}
                />
              </>
            ) : (
              <p className="text-sm text-neutral-500">
                Select at least two laps (with a track reference built) to see a delta trace.
              </p>
            ))}

          {comparisonTab === "sectors" &&
            (activeReference ? (
              <SectorTimeTable sectorCount={activeReference.sectors.length} laps={selectedLaps} />
            ) : (
              <p className="text-sm text-neutral-500">Build a track reference first to see sector times.</p>
            ))}
        </div>
      )}
    </div>
  );
}
