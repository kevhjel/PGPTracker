import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireAdmin } from "./lib/adminAuth";
import { boundingBoxCenter, projectToLocalMeters } from "./lib/geo";
import { buildTrackReference } from "./lib/trackGeometry";
import { projectLapOntoReference } from "./lib/trackProjection";

// Personal GPS telemetry, not public race data - unlike the rest of this
// app's queries, reads here require the admin secret too, not just writes.

const TRACK_ORIGIN_KEY = "gpsTrackOrigin";

/**
 * Whichever of trackBounds or trackReference gets built first claims the
 * shared coordinate origin (stored in appSettings, reusing its existing
 * key/value pattern); the other aligns to it later instead of each picking
 * its own origin independently, which would make them project into
 * different local frames and never overlay correctly.
 */
async function getOrSetTrackOrigin(
  ctx: { db: any },
  fallback: { lat: number; lon: number },
): Promise<{ lat: number; lon: number }> {
  const row = await ctx.db
    .query("appSettings")
    .withIndex("by_key", (q: any) => q.eq("key", TRACK_ORIGIN_KEY))
    .unique();
  if (row) return row.value as { lat: number; lon: number };
  await ctx.db.insert("appSettings", { key: TRACK_ORIGIN_KEY, value: fallback });
  return fallback;
}

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
        source: v.union(v.literal("trkseg"), v.literal("self_crossing"), v.literal("reference_crossing")),
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
    const activeRef = await ctx.db
      .query("trackReference")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .unique();

    for (const lap of laps) {
      const projection = activeRef ? projectLap(lap.points, activeRef) : undefined;
      await ctx.db.insert("gpsLaps", { sessionId, ...lap, projection });
    }
    await ctx.db.patch(sessionId, { status: "parsed", lapCount: laps.length });
  },
});

function projectLap(
  points: { lat: number; lon: number; t: number }[],
  reference: {
    _id: any;
    originLat: number;
    originLon: number;
    polyline: any;
    sectors: any;
    totalDistanceM: number;
  },
) {
  const result = projectLapOntoReference(points, reference);
  return {
    referenceId: reference._id,
    points: result.points,
    sectorTimes: result.sectorTimes,
    lapTimeMsRefined: result.lapTimeMsRefined,
  };
}

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

export const getLapsByIds = query({
  args: { lapIds: v.array(v.id("gpsLaps")), adminSecret: v.string() },
  handler: async (ctx, { lapIds, adminSecret }) => {
    requireAdmin(adminSecret);
    const laps = await Promise.all(lapIds.map((id) => ctx.db.get(id)));
    return laps.filter((l): l is NonNullable<typeof l> => l !== null);
  },
});

/** The shared coordinate origin (see getOrSetTrackOrigin), if either bounds or a reference has established one. */
export const getTrackOrigin = query({
  args: { adminSecret: v.string() },
  handler: async (ctx, { adminSecret }) => {
    requireAdmin(adminSecret);
    const row = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", TRACK_ORIGIN_KEY))
      .unique();
    return (row?.value as { lat: number; lon: number } | undefined) ?? null;
  },
});

/** Deletes an uploaded session, its laps, and its stored file. */
export const deleteSession = mutation({
  args: { sessionId: v.id("gpsSessions"), adminSecret: v.string() },
  handler: async (ctx, { sessionId, adminSecret }) => {
    requireAdmin(adminSecret);
    await deleteSessionCascade(ctx, sessionId);
  },
});

/** Deletes every uploaded session, its laps, and its stored file - for clearing out test data in bulk. */
export const deleteAllSessions = mutation({
  args: { adminSecret: v.string() },
  handler: async (ctx, { adminSecret }) => {
    requireAdmin(adminSecret);
    const sessions = await ctx.db.query("gpsSessions").collect();
    for (const session of sessions) {
      await deleteSessionCascade(ctx, session._id);
    }
  },
});

async function deleteSessionCascade(ctx: { db: any; storage: any }, sessionId: any) {
  const session = await ctx.db.get(sessionId);
  if (!session) return;
  const laps = await ctx.db
    .query("gpsLaps")
    .withIndex("by_session", (q: any) => q.eq("sessionId", sessionId))
    .collect();
  for (const lap of laps) {
    await ctx.db.delete(lap._id);
  }
  await ctx.storage.delete(session.storageId);
  await ctx.db.delete(sessionId);
}

/** Deletes every uploaded track-bounds file (current and historical). */
export const deleteAllTrackBounds = mutation({
  args: { adminSecret: v.string() },
  handler: async (ctx, { adminSecret }) => {
    requireAdmin(adminSecret);
    const rows = await ctx.db.query("trackBounds").collect();
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
  },
});

/** Deletes every built track reference (current and historical) and clears any lap projections that pointed at them. */
export const deleteAllTrackReferences = mutation({
  args: { adminSecret: v.string() },
  handler: async (ctx, { adminSecret }) => {
    requireAdmin(adminSecret);
    const rows = await ctx.db.query("trackReference").collect();
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    const laps = await ctx.db.query("gpsLaps").collect();
    for (const lap of laps) {
      if (lap.projection) {
        await ctx.db.patch(lap._id, { projection: undefined });
      }
    }
  },
});

/** Admin picks a clean uploaded lap to become the persistent track reference; reprojects every existing lap against it. */
export const buildTrackReferenceFromLap = mutation({
  args: { lapId: v.id("gpsLaps"), adminSecret: v.string() },
  handler: async (ctx, { lapId, adminSecret }) => {
    requireAdmin(adminSecret);
    const lap = await ctx.db.get(lapId);
    if (!lap) throw new Error("Lap not found.");
    if (lap.points.length < 10) {
      throw new Error("This lap doesn't have enough points to build a reliable track reference.");
    }

    const origin = await getOrSetTrackOrigin(ctx, boundingBoxCenter(lap.points));
    const built = buildTrackReference(lap.points, origin.lat, origin.lon);

    const priorActive = await ctx.db
      .query("trackReference")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect();
    for (const row of priorActive) {
      await ctx.db.patch(row._id, { isActive: false });
    }

    const referenceId = await ctx.db.insert("trackReference", {
      sourceLapId: lapId,
      createdAt: Date.now(),
      isActive: true,
      originLat: origin.lat,
      originLon: origin.lon,
      totalDistanceM: built.totalDistanceM,
      polyline: built.polyline,
      sectors: built.sectors,
      buildParams: {
        resampleSpacingM: 2,
        curvatureThresholdRadPerM: 0.03,
        minSegmentLengthM: 15,
      },
    });

    const reference = {
      _id: referenceId,
      originLat: origin.lat,
      originLon: origin.lon,
      polyline: built.polyline,
      sectors: built.sectors,
      totalDistanceM: built.totalDistanceM,
    };
    const allLaps = await ctx.db.query("gpsLaps").collect();
    for (const l of allLaps) {
      await ctx.db.patch(l._id, { projection: projectLap(l.points, reference) });
    }

    return { referenceId, sectorCount: built.sectors.length, usedFallbackSectors: built.usedFallbackSectors };
  },
});

/** The currently-active persistent track reference, if one has been built. */
export const getActiveTrackReference = query({
  args: { adminSecret: v.string() },
  handler: async (ctx, { adminSecret }) => {
    requireAdmin(adminSecret);
    return await ctx.db
      .query("trackReference")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .unique();
  },
});

/** Called by the parseTrackBounds action once it has extracted lat/lon rings from the uploaded file. */
export const insertTrackBounds = internalMutation({
  args: {
    sourceFormat: v.union(v.literal("geojson"), v.literal("gpx")),
    outline: v.optional(v.array(v.object({ lat: v.number(), lon: v.number() }))),
    innerEdge: v.optional(v.array(v.object({ lat: v.number(), lon: v.number() }))),
    outerEdge: v.optional(v.array(v.object({ lat: v.number(), lon: v.number() }))),
  },
  handler: async (ctx, args) => {
    const priorActive = await ctx.db
      .query("trackBounds")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect();
    for (const row of priorActive) {
      await ctx.db.patch(row._id, { isActive: false });
    }

    await ctx.db.insert("trackBounds", { ...args, createdAt: Date.now(), isActive: true });

    const originCandidate = args.outerEdge ?? args.outline ?? args.innerEdge ?? [];
    if (originCandidate.length > 0) {
      await getOrSetTrackOrigin(ctx, boundingBoxCenter(originCandidate));
    }
  },
});

/** Active track-bounds shape, projected into the shared local (x,y) frame ready to draw. */
export const getTrackBounds = query({
  args: { adminSecret: v.string() },
  handler: async (ctx, { adminSecret }) => {
    requireAdmin(adminSecret);
    const bounds = await ctx.db
      .query("trackBounds")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .unique();
    if (!bounds) return null;

    const originRow = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", TRACK_ORIGIN_KEY))
      .unique();
    const origin =
      (originRow?.value as { lat: number; lon: number } | undefined) ??
      boundingBoxCenter(bounds.outerEdge ?? bounds.outline ?? bounds.innerEdge ?? []);

    const project = (pts?: { lat: number; lon: number }[]) =>
      pts?.map((p) => projectToLocalMeters(p.lat, p.lon, origin.lat, origin.lon));

    return {
      outline: project(bounds.outline),
      innerEdge: project(bounds.innerEdge),
      outerEdge: project(bounds.outerEdge),
    };
  },
});
