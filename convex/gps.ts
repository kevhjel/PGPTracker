import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireAdmin } from "./lib/adminAuth";

// Personal GPS telemetry, not public race data - unlike the rest of this
// app's queries, reads here require the admin secret too, not just writes.

export const generateUploadUrl = mutation({
  args: { adminSecret: v.string() },
  handler: async (ctx, { adminSecret }) => {
    requireAdmin(adminSecret);
    return await ctx.storage.generateUploadUrl();
  },
});

export const createSession = mutation({
  args: { storageId: v.id("_storage"), fileName: v.string(), adminSecret: v.string() },
  handler: async (ctx, { storageId, fileName, adminSecret }) => {
    requireAdmin(adminSecret);
    const sessionId = await ctx.db.insert("gpsSessions", {
      storageId,
      fileName,
      uploadedAt: Date.now(),
      status: "pending",
    });
    await ctx.scheduler.runAfter(0, internal.actions.parseGpx.run, { sessionId, storageId });
    return sessionId;
  },
});

/** Called by the parseGpx action once it has split the file into laps. */
export const insertParsedLaps = internalMutation({
  args: {
    sessionId: v.id("gpsSessions"),
    laps: v.array(
      v.object({
        lapIndex: v.number(),
        source: v.union(v.literal("trkseg"), v.literal("reference_crossing")),
        startTime: v.number(),
        endTime: v.number(),
        durationMs: v.number(),
        points: v.array(
          v.object({ lat: v.number(), lon: v.number(), t: v.number(), ele: v.optional(v.number()) }),
        ),
      }),
    ),
  },
  handler: async (ctx, { sessionId, laps }) => {
    for (const lap of laps) {
      await ctx.db.insert("gpsLaps", { sessionId, ...lap });
    }
    await ctx.db.patch(sessionId, { status: "parsed", lapCount: laps.length });
  },
});

export const markSessionError = internalMutation({
  args: { sessionId: v.id("gpsSessions"), errorMessage: v.string() },
  handler: async (ctx, { sessionId, errorMessage }) => {
    await ctx.db.patch(sessionId, { status: "error", errorMessage });
  },
});

export const listSessions = query({
  args: { adminSecret: v.string() },
  handler: async (ctx, { adminSecret }) => {
    requireAdmin(adminSecret);
    return await ctx.db.query("gpsSessions").order("desc").collect();
  },
});

export const listLaps = query({
  args: { sessionId: v.id("gpsSessions"), adminSecret: v.string() },
  handler: async (ctx, { sessionId, adminSecret }) => {
    requireAdmin(adminSecret);
    const laps = await ctx.db
      .query("gpsLaps")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    return laps.sort((a, b) => a.lapIndex - b.lapIndex);
  },
});

export const getLap = query({
  args: { lapId: v.id("gpsLaps"), adminSecret: v.string() },
  handler: async (ctx, { lapId, adminSecret }) => {
    requireAdmin(adminSecret);
    return await ctx.db.get(lapId);
  },
});
