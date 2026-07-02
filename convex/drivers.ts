import { v } from "convex/values";
import { query, mutation, internalMutation, internalQuery } from "./_generated/server";
import type { Id, Doc } from "./_generated/dataModel";
import { requireAdmin } from "./lib/adminAuth";

export const getByCustId = internalQuery({
  args: { custId: v.string() },
  handler: async (ctx, { custId }) => {
    return await ctx.db
      .query("drivers")
      .withIndex("by_custId", (q) => q.eq("custId", custId))
      .unique();
  },
});

export const getById = query({
  args: { driverId: v.id("drivers") },
  handler: async (ctx, { driverId }) => {
    return await ctx.db.get(driverId);
  },
});

export const listWatched = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("drivers")
      .withIndex("by_watched", (q) => q.eq("isWatched", true))
      .collect();
  },
});

export const search = query({
  args: { text: v.string() },
  handler: async (ctx, { text }) => {
    const needle = text.toLowerCase();
    if (!needle) return [];
    // Small-scale substring search over drivers; fine at this dataset size
    // since it's an admin-only lookup tool, not a hot public path.
    const all = await ctx.db.query("drivers").collect();
    return all
      .filter(
        (d) =>
          d.displayName.toLowerCase().includes(needle) ||
          d.custId.includes(needle) ||
          d.nameVariantsSeen.some((n) => n.toLowerCase().includes(needle)),
      )
      .slice(0, 50);
  },
});

/** All-time fastest-lap leaderboard - a single indexed read, zero computation. */
export const allTimeLeaderboard = query({
  args: { category: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { category, limit }) => {
    const take = limit ?? 100;
    let ranked: { driver: Doc<"drivers">; bestLapMs: number; heatId?: Id<"heats"> }[];
    if (category) {
      const drivers = await ctx.db.query("drivers").collect();
      ranked = drivers
        .filter((d) => d.bestLapByCategory?.[category] && !d.mergedIntoDriverId)
        .sort((a, b) => a.bestLapByCategory![category].lapMs - b.bestLapByCategory![category].lapMs)
        .slice(0, take)
        .map((d) => ({ driver: d, bestLapMs: d.bestLapByCategory![category].lapMs, heatId: d.bestLapByCategory![category].heatId }));
    } else {
      const drivers = await ctx.db
        .query("drivers")
        .withIndex("by_bestLap")
        .order("asc")
        .collect();
      ranked = drivers
        .filter((d) => d.bestLapMs !== undefined && !d.mergedIntoDriverId)
        .slice(0, take)
        .map((d) => ({ driver: d, bestLapMs: d.bestLapMs!, heatId: d.bestLapHeatId }));
    }
    return await Promise.all(
      ranked.map(async (r) => ({ ...r, heat: r.heatId ? await ctx.db.get(r.heatId) : null })),
    );
  },
});

export const setWatched = mutation({
  args: { driverId: v.id("drivers"), isWatched: v.boolean(), adminSecret: v.string() },
  handler: async (ctx, { driverId, isWatched, adminSecret }) => {
    requireAdmin(adminSecret);
    await ctx.db.patch(driverId, { isWatched });
  },
});

export const updateDisplayName = mutation({
  args: { driverId: v.id("drivers"), displayName: v.string(), adminSecret: v.string() },
  handler: async (ctx, { driverId, displayName, adminSecret }) => {
    requireAdmin(adminSecret);
    await ctx.db.patch(driverId, { displayName });
  },
});

/** Full recompute of a driver's aggregates from their own heatEntries. Bounded by that driver's heat count, not the global dataset. */
export async function recomputeDriverAggregates(
  ctx: { db: any },
  driverId: Id<"drivers">,
) {
  const entries = await ctx.db
    .query("heatEntries")
    .withIndex("by_driver", (q: any) => q.eq("driverId", driverId))
    .collect();

  let totalLaps = 0;
  let bestLapMs: number | undefined;
  let bestLapHeatId: Id<"heats"> | undefined;
  let firstSeenHeatNo = Infinity;
  let lastSeenHeatNo = -Infinity;
  const bestLapByCategory: Record<string, { lapMs: number; heatId: Id<"heats"> }> = {};

  for (const e of entries) {
    totalLaps += e.numLaps;
    firstSeenHeatNo = Math.min(firstSeenHeatNo, e.heatNo);
    lastSeenHeatNo = Math.max(lastSeenHeatNo, e.heatNo);
    if (e.bestLapMs !== undefined) {
      if (bestLapMs === undefined || e.bestLapMs < bestLapMs) {
        bestLapMs = e.bestLapMs;
        bestLapHeatId = e.heatId;
      }
      const catBest = bestLapByCategory[e.heatCategory];
      if (!catBest || e.bestLapMs < catBest.lapMs) {
        bestLapByCategory[e.heatCategory] = { lapMs: e.bestLapMs, heatId: e.heatId };
      }
    }
  }

  await ctx.db.patch(driverId, {
    totalHeats: entries.length,
    totalLaps,
    bestLapMs,
    bestLapHeatId,
    bestLapByCategory: Object.keys(bestLapByCategory).length > 0 ? bestLapByCategory : undefined,
    firstSeenHeatNo: entries.length > 0 ? firstSeenHeatNo : 0,
    lastSeenHeatNo: entries.length > 0 ? lastSeenHeatNo : 0,
  });
}

/**
 * Merge two driver records (e.g. ClubSpeed issued a second CustID to the
 * same person). Executed as a one-time migration: reassign every
 * heatEntries.driverId from source -> target, recompute target's totals,
 * mark source as merged. Every other query stays simple - nothing needs to
 * "follow the pointer" at read time.
 */
export const mergeDrivers = mutation({
  args: {
    sourceDriverId: v.id("drivers"),
    targetDriverId: v.id("drivers"),
    reason: v.optional(v.string()),
    adminSecret: v.string(),
  },
  handler: async (ctx, { sourceDriverId, targetDriverId, reason, adminSecret }) => {
    requireAdmin(adminSecret);
    if (sourceDriverId === targetDriverId) {
      throw new Error("Cannot merge a driver into itself");
    }
    const source = await ctx.db.get(sourceDriverId);
    const target = await ctx.db.get(targetDriverId);
    if (!source || !target) throw new Error("Driver not found");

    const sourceEntries = await ctx.db
      .query("heatEntries")
      .withIndex("by_driver", (q) => q.eq("driverId", sourceDriverId))
      .collect();
    for (const entry of sourceEntries) {
      await ctx.db.patch(entry._id, { driverId: targetDriverId });
    }

    await ctx.db.patch(targetDriverId, {
      nameVariantsSeen: Array.from(
        new Set([...target.nameVariantsSeen, ...source.nameVariantsSeen, source.displayName]),
      ),
    });

    await recomputeDriverAggregates(ctx, targetDriverId);

    await ctx.db.patch(sourceDriverId, { mergedIntoDriverId: targetDriverId });

    await ctx.db.insert("driverMerges", {
      sourceDriverId,
      targetDriverId,
      mergedAt: Date.now(),
      reason,
    });
  },
});

export const recomputeAggregates = internalMutation({
  args: { driverId: v.id("drivers") },
  handler: async (ctx, { driverId }) => {
    await recomputeDriverAggregates(ctx, driverId);
  },
});

export const patchFromRacerHistory = internalMutation({
  args: {
    driverId: v.id("drivers"),
    displayName: v.optional(v.string()),
    kartsByHeatNo: v.array(v.object({ heatNo: v.number(), kartNo: v.number() })),
  },
  handler: async (ctx, { driverId, displayName, kartsByHeatNo }) => {
    const driver = await ctx.db.get(driverId);
    if (!driver) return;

    if (displayName && displayName !== driver.displayName) {
      await ctx.db.patch(driverId, {
        displayName,
        nameVariantsSeen: Array.from(new Set([...driver.nameVariantsSeen, displayName])),
      });
    }

    for (const { heatNo, kartNo } of kartsByHeatNo) {
      const entry = await ctx.db
        .query("heatEntries")
        .withIndex("by_heatNo", (q) => q.eq("heatNo", heatNo))
        .filter((q) => q.eq(q.field("driverId"), driverId))
        .unique();
      if (entry) {
        await ctx.db.patch(entry._id, { kartNo });
      }
    }
  },
});
