"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { requireAdmin } from "../lib/adminAuth";
import { parseTrackBoundsGeoJson } from "../lib/geoJsonBounds";

/**
 * Small file, quick parse - called directly by the client and awaited
 * (unlike lap parsing, which is scheduled so it survives the tab closing),
 * so a bad file just rejects the promise and the upload control can show
 * the error immediately.
 */
export const run = action({
  args: {
    storageId: v.id("_storage"),
    sourceFormat: v.union(v.literal("geojson"), v.literal("gpx")),
    adminSecret: v.string(),
  },
  handler: async (ctx, { storageId, sourceFormat, adminSecret }) => {
    requireAdmin(adminSecret);
    const blob = await ctx.storage.get(storageId);
    if (!blob) {
      throw new Error("Uploaded file not found in storage.");
    }
    const text = await blob.text();

    if (sourceFormat !== "geojson") {
      throw new Error("GPX track-bounds files aren't supported yet - upload a GeoJSON file.");
    }
    const parsed = parseTrackBoundsGeoJson(text);
    await ctx.runMutation(internal.gps.insertTrackBounds, { sourceFormat, ...parsed });
  },
});
