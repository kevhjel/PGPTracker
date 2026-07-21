"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { parseGpx } from "../lib/gpxParse";

const MIN_POINTS_PER_LAP = 5;

/**
 * Splits on <trkseg> boundaries - watches typically emit one per manually-
 * lapped lap. A single trkseg spanning the whole file is stored as one lap;
 * splitting that case by track position instead (reference_crossing) needs
 * an already-built trackReference, so it isn't available until one exists.
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

      const laps = segments
        .filter((points) => points.length >= MIN_POINTS_PER_LAP)
        .map((points) => {
          const sorted = [...points].sort((a, b) => a.t - b.t);
          return {
            points: sorted,
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
          source: "trkseg" as const,
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
