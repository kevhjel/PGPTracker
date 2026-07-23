import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { query, mutation, internalMutation, internalQuery } from "./_generated/server";
import type { Id, Doc } from "./_generated/dataModel";
import { requireAdmin } from "./lib/adminAuth";
import { MIN_VALID_LAP_MS } from "./lib/constants";
import { updateRivalriesForHeat, mergeRivalries } from "./lib/rivalries";

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

/** Top 8 opponents this driver has shared the most heats with, and the head-to-head record against each. Reads from the driverRivalries cache, kept up to date incrementally at heat-ingestion time (see updateRivalriesForHeat) - a single bounded indexed query regardless of the driver's total heat count. */
export const getRivals = query({
  args: { driverId: v.id("drivers") },
  handler: async (ctx, { driverId }) => {
    const top = await ctx.db
      .query("driverRivalries")
      .withIndex("by_driver_races", (q) => q.eq("driverId", driverId))
      .order("desc")
      .take(8);

    const withDrivers = await Promise.all(
      top.map(async (r) => ({
        driver: await ctx.db.get(r.opponentId),
        races: r.races,
        wins: r.wins,
        losses: r.losses,
      })),
    );
    return withDrivers.filter((r) => r.driver !== null);
  },
});

/** Head-to-head record between two specific drivers. Single indexed lookup against the driverRivalries cache. */
export const getHeadToHead = query({
  args: { driverId: v.id("drivers"), opponentId: v.id("drivers") },
  handler: async (ctx, { driverId, opponentId }) => {
    if (driverId === opponentId) return { races: 0, wins: 0, losses: 0 };

    const rivalry = await ctx.db
      .query("driverRivalries")
      .withIndex("by_driver_opponent", (q) => q.eq("driverId", driverId).eq("opponentId", opponentId))
      .unique();

    return rivalry
      ? { races: rivalry.races, wins: rivalry.wins, losses: rivalry.losses }
      : { races: 0, wins: 0, losses: 0 };
  },
});

export const listWatched = query({
  args: {},
  handler: async (ctx) => {
    const drivers = await ctx.db
      .query("drivers")
      .withIndex("by_watched", (q) => q.eq("isWatched", true))
      .collect();

    return await Promise.all(
      drivers.map(async (driver) => {
        const lastHeat = driver.lastSeenHeatNo
          ? await ctx.db
              .query("heats")
              .withIndex("by_heatNo", (q) => q.eq("heatNo", driver.lastSeenHeatNo))
              .unique()
          : null;
        return { ...driver, lastHeatDate: lastHeat?.raceDateTime ?? null };
      }),
    );
  },
});

/**
 * Type-ahead driver search, backed by a Convex search index (fuzzy/prefix
 * match on displayName) rather than a full-table scan - needs to stay fast
 * as the driver count grows into the tens of thousands, and this is a
 * public-facing path, not just an admin tool.
 */
export const search = query({
  args: { text: v.string() },
  handler: async (ctx, { text }) => {
    const trimmed = text.trim();
    if (!trimmed) return [];

    let custIdMatch: Doc<"drivers"> | null = null;
    if (/^\d+$/.test(trimmed)) {
      custIdMatch = await ctx.db
        .query("drivers")
        .withIndex("by_custId", (q) => q.eq("custId", trimmed))
        .unique();
    }

    const nameMatches = await ctx.db
      .query("drivers")
      .withSearchIndex("search_displayName", (q) => q.search("displayName", trimmed))
      .take(20);

    const results = custIdMatch
      ? [custIdMatch, ...nameMatches.filter((d) => d._id !== custIdMatch!._id)]
      : nameMatches;

    return results.filter((d) => !d.mergedIntoDriverId).slice(0, 20);
  },
});

/**
 * All-time fastest-lap leaderboard. Reads from heatEntries via an indexed,
 * bounded range scan (never a full-table collect - the drivers table alone
 * has ~100k rows, well past Convex's per-function read limit) so both the
 * unfiltered and category-filtered cases stay cheap regardless of dataset
 * size, and both apply the same MIN_VALID_LAP_MS floor.
 */
export const allTimeLeaderboard = query({
  args: { category: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { category, limit }) => {
    const take = Math.min(limit ?? 100, 200);
    const overfetchCap = take * 5;

    const candidates = category
      ? await ctx.db
          .query("heatEntries")
          .withIndex("by_category_bestLap", (q) => q.eq("heatCategory", category).gte("bestLapMs", MIN_VALID_LAP_MS))
          .order("asc")
          .take(overfetchCap)
      : await ctx.db
          .query("heatEntries")
          .withIndex("by_bestLap", (q) => q.gte("bestLapMs", MIN_VALID_LAP_MS))
          .order("asc")
          .take(overfetchCap);

    const bestPerDriver = new Map<string, { driverId: Id<"drivers">; bestLapMs: number; heatId: Id<"heats"> }>();
    for (const e of candidates) {
      if (!e.driverId || e.bestLapMs === undefined) continue;
      if (!bestPerDriver.has(e.driverId)) {
        bestPerDriver.set(e.driverId, { driverId: e.driverId, bestLapMs: e.bestLapMs, heatId: e.heatId });
      }
    }

    const rows = await Promise.all(
      Array.from(bestPerDriver.values()).map(async (r) => ({
        driver: await ctx.db.get(r.driverId),
        bestLapMs: r.bestLapMs,
        heat: await ctx.db.get(r.heatId),
      })),
    );

    return rows
      .filter((r): r is typeof r & { driver: Doc<"drivers"> } => !!r.driver && !r.driver.mergedIntoDriverId)
      .sort((a, b) => a.bestLapMs - b.bestLapMs)
      .slice(0, take);
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
  let totalWins = 0;
  let totalPodiums = 0;
  let bestLapMs: number | undefined;
  let bestLapHeatId: Id<"heats"> | undefined;
  let firstSeenHeatNo = Infinity;
  let lastSeenHeatNo = -Infinity;
  const bestLapByCategory: Record<string, { lapMs: number; heatId: Id<"heats"> }> = {};

  for (const e of entries) {
    totalLaps += e.numLaps;
    if (e.position === 1) totalWins++;
    if (e.position >= 1 && e.position <= 3) totalPodiums++;
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
    totalWins,
    totalPodiums,
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
    await mergeRivalries(ctx, sourceDriverId, targetDriverId);

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

const WINS_PODIUMS_MIGRATION_DONE_KEY = "winsPodiumsMigrationDone";

/** One-time backfill of totalWins/totalPodiums (added after most drivers
 * already existed) via recomputeDriverAggregates, paginated across the
 * whole drivers table. Call repeatedly passing back the previous
 * continueCursor until isDone; locks itself out via appSettings afterward
 * so a stray re-run is a no-op rather than redundant work. */
export const backfillWinsPodiumsBatch = internalMutation({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const alreadyDone = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", WINS_PODIUMS_MIGRATION_DONE_KEY))
      .unique();
    if (alreadyDone) {
      return { isDone: true, continueCursor: "", processedCount: 0, skipped: "already run" };
    }

    const result = await ctx.db.query("drivers").paginate(paginationOpts);
    for (const driver of result.page) {
      await recomputeDriverAggregates(ctx, driver._id);
    }
    if (result.isDone) {
      await ctx.db.insert("appSettings", { key: WINS_PODIUMS_MIGRATION_DONE_KEY, value: Date.now() });
    }
    return { isDone: result.isDone, continueCursor: result.continueCursor, processedCount: result.page.length };
  },
});

const RIVALRIES_MIGRATION_DONE_KEY = "driverRivalriesMigrationDone";

/** One-time backfill of driverRivalries from existing heats, paginated across
 * the whole heats table so each call stays bounded regardless of how much
 * history exists. Call repeatedly passing back the previous continueCursor
 * until isDone; locks itself out via appSettings afterward so a stray
 * re-run is a no-op rather than double-counting. */
export const backfillDriverRivalriesBatch = internalMutation({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const alreadyDone = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", RIVALRIES_MIGRATION_DONE_KEY))
      .unique();
    if (alreadyDone) {
      return { isDone: true, continueCursor: "", processedCount: 0, skipped: "already run" };
    }

    const result = await ctx.db.query("heats").paginate(paginationOpts);
    for (const heat of result.page) {
      const entries = await ctx.db
        .query("heatEntries")
        .withIndex("by_heat", (q) => q.eq("heatId", heat._id))
        .collect();
      await updateRivalriesForHeat(
        ctx,
        [],
        entries.map((e) => ({ driverId: e.driverId, position: e.position })),
      );
    }
    if (result.isDone) {
      await ctx.db.insert("appSettings", { key: RIVALRIES_MIGRATION_DONE_KEY, value: Date.now() });
    }
    return { isDone: result.isDone, continueCursor: result.continueCursor, processedCount: result.page.length };
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
