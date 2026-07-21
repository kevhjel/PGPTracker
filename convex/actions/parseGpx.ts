"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { parseGpx, type GpxPoint } from "../lib/gpxParse";
import { splitLapsBySelfCrossing } from "../lib/lapSplit";

const MIN_POINTS_PER_LAP = 5;

/**
 * Prefers <trkseg> boundaries when the file actually has more than one -
 * some exporters do emit one per manually-lapped lap. In practice most GPX
 * exports (unlike TCX/FIT) don't preserve lap-button presses at all and
 * hand back a single trkseg for the whole session, so that case falls back
 * to self-crossing detection (see lapSplit.ts) - splitting by where the
 * path returns near its own start point, which needs nothing but the lap's
 * own recorded points, not a pre-built trackReference.
 */
export const run = internalAction({
  args: { sessionId: v.id("gpsSessions"), storageId: v.id("_storage") },
  handler: async (ctx, { sessionId, storageId }) => {
    try {
      const blob = await ctx.storage.get(storageId);
      if (!blob) {
        throw new Error("Uploaded file not found in storage.");
      }
      const text = await blob.text();
      const { segments } = parseGpx(text);

      const rawGroups: { points: GpxPoint[]; source: "trkseg" | "self_crossing" }[] =
        segments.length > 1
          ? segments.map((points) => ({ points, source: "trkseg" as const }))
          : splitLapsBySelfCrossing(segments[0]).map((points) => ({ points, source: "self_crossing" as const }));

      const laps = rawGroups
        .filter((g) => g.points.length >= MIN_POINTS_PER_LAP)
        .map((g) => {
          const sorted = [...g.points].sort((a, b) => a.t - b.t);
          return {
            points: sorted,
            source: g.source,
            startTime: sorted[0].t,
            endTime: sorted[sorted.length - 1].t,
            durationMs: sorted[sorted.length - 1].t - sorted[0].t,
          };
        });

      if (laps.length === 0) {
        throw new Error("No usable laps found (every track segment had fewer than 5 points).");
      }

      await ctx.runMutation(internal.gps.insertParsedLaps, {
        sessionId,
        laps: laps.map((lap, i) => ({
          lapIndex: i,
          source: lap.source,
          startTime: lap.startTime,
          endTime: lap.endTime,
          durationMs: lap.durationMs,
          points: lap.points,
        })),
      });
    } catch (err) {
      await ctx.runMutation(internal.gps.markSessionError, {
        sessionId,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  },
});
