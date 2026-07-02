import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { query, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { recomputeDriverAggregates } from "./drivers";

const heatCategoryValidator = v.union(
  v.literal("arrive_and_drive"),
  v.literal("league"),
  v.literal("pro_am"),
  v.literal("group_event"),
  v.literal("practice"),
  v.literal("endurance"),
  v.literal("other"),
);

export const getByHeatNo = query({
  args: { heatNo: v.number() },
  handler: async (ctx, { heatNo }) => {
    const heat = await ctx.db
      .query("heats")
      .withIndex("by_heatNo", (q) => q.eq("heatNo", heatNo))
      .unique();
    if (!heat) return null;
    const entries = await ctx.db
      .query("heatEntries")
      .withIndex("by_heat", (q) => q.eq("heatId", heat._id))
      .collect();
    entries.sort((a, b) => a.position - b.position);
    return { heat, entries };
  },
});

export const listRecent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    return await ctx.db
      .query("heats")
      .withIndex("by_date")
      .order("desc")
      .take(limit ?? 25);
  },
});

export const listEmptyForRecheck = internalQuery({
  args: { maxAgeMs: v.number(), limit: v.number() },
  handler: async (ctx, { maxAgeMs, limit }) => {
    const cutoff = Date.now() - maxAgeMs;
    const heats = await ctx.db
      .query("heats")
      .withIndex("by_status", (q) => q.eq("status", "empty"))
      .collect();
    return heats.filter((h) => h.raceDateTime >= cutoff).slice(0, limit);
  },
});

export const listByStatus = query({
  args: { status: v.union(v.literal("scraped"), v.literal("empty"), v.literal("error")), limit: v.optional(v.number()) },
  handler: async (ctx, { status, limit }) => {
    return await ctx.db
      .query("heats")
      .withIndex("by_status", (q) => q.eq("status", status))
      .take(limit ?? 100);
  },
});

export const listByCategory = query({
  args: { category: heatCategoryValidator, limit: v.optional(v.number()) },
  handler: async (ctx, { category, limit }) => {
    return await ctx.db
      .query("heats")
      .withIndex("by_category", (q) => q.eq("heatCategory", category))
      .order("desc")
      .take(limit ?? 100);
  },
});

/** Team/endurance heats with their podium (top 3 by position). */
export const listEndurancePodiums = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const heats = await ctx.db
      .query("heats")
      .withIndex("by_category", (q) => q.eq("heatCategory", "endurance"))
      .order("desc")
      .take(limit ?? 50);

    return await Promise.all(
      heats.map(async (heat) => {
        const entries = await ctx.db
          .query("heatEntries")
          .withIndex("by_heat", (q) => q.eq("heatId", heat._id))
          .collect();
        entries.sort((a, b) => a.position - b.position);
        return { heat, podium: entries.slice(0, 3) };
      }),
    );
  },
});

/** Every lap this driver has ever run, flattened and chronological - bounded by their own heat count, not the global dataset. */
export const listAllLapsForDriver = query({
  args: { driverId: v.id("drivers") },
  handler: async (ctx, { driverId }) => {
    const entries = await ctx.db
      .query("heatEntries")
      .withIndex("by_driver", (q) => q.eq("driverId", driverId))
      .collect();

    const withDates = await Promise.all(
      entries.map(async (e) => ({ entry: e, heat: await ctx.db.get(e.heatId) })),
    );
    withDates.sort((a, b) => (a.heat?.raceDateTime ?? 0) - (b.heat?.raceDateTime ?? 0));

    const laps: { heatNo: number; raceDateTime: number; lapNo: number; lapTimeMs: number }[] = [];
    for (const { entry, heat } of withDates) {
      if (!heat) continue;
      for (const lap of entry.laps) {
        laps.push({ heatNo: entry.heatNo, raceDateTime: heat.raceDateTime, lapNo: lap.lapNo, lapTimeMs: lap.lapTimeMs });
      }
    }
    return laps;
  },
});

export const listEntriesByDriver = query({
  args: { driverId: v.id("drivers"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { driverId, paginationOpts }) => {
    const result = await ctx.db
      .query("heatEntries")
      .withIndex("by_driver", (q) => q.eq("driverId", driverId))
      .order("desc")
      .paginate(paginationOpts);
    const withHeats = await Promise.all(
      result.page.map(async (entry) => ({
        entry,
        heat: await ctx.db.get(entry.heatId),
      })),
    );
    return { ...result, page: withHeats };
  },
});

/** Date-scoped leaderboard: the one variant that can't use a driver's cached
 * all-time PB, since a PB field only ever holds the single best-ever value. */
export const dateScopedLeaderboard = query({
  args: {
    category: v.optional(v.string()),
    fromMs: v.optional(v.number()),
    toMs: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { category, fromMs, toMs, limit }) => {
    const entries = category
      ? await ctx.db
          .query("heatEntries")
          .withIndex("by_category_bestLap", (q) => q.eq("heatCategory", category))
          .collect()
      : await ctx.db.query("heatEntries").collect();

    const bestPerDriver = new Map<string, (typeof entries)[number]>();
    for (const e of entries) {
      if (!e.driverId || e.bestLapMs === undefined) continue;
      const heat = await ctx.db.get(e.heatId);
      if (!heat) continue;
      if (fromMs !== undefined && heat.raceDateTime < fromMs) continue;
      if (toMs !== undefined && heat.raceDateTime > toMs) continue;
      const existing = bestPerDriver.get(e.driverId);
      if (!existing || (existing.bestLapMs ?? Infinity) > e.bestLapMs) {
        bestPerDriver.set(e.driverId, e);
      }
    }

    const ranked = Array.from(bestPerDriver.values()).sort(
      (a, b) => (a.bestLapMs ?? Infinity) - (b.bestLapMs ?? Infinity),
    );
    const take = limit ?? 100;
    return await Promise.all(
      ranked.slice(0, take).map(async (e) => ({
        entry: e,
        driver: e.driverId ? await ctx.db.get(e.driverId) : null,
        heat: await ctx.db.get(e.heatId),
      })),
    );
  },
});

const heatEntryInput = v.object({
  driverNameRaw: v.string(),
  custId: v.optional(v.string()),
  teamName: v.optional(v.string()),
  position: v.number(),
  bestLapMs: v.optional(v.number()),
  gapFromLeaderMs: v.optional(v.number()),
  numLaps: v.number(),
  avgLapMs: v.optional(v.number()),
  proSkill: v.optional(v.number()),
  laps: v.array(
    v.object({
      lapNo: v.number(),
      lapTimeMs: v.number(),
      positionAtLap: v.optional(v.number()),
    }),
  ),
});

/** Single batched write per heat: heat doc + all entries + driver upserts + stats counters. */
export const upsertHeat = internalMutation({
  args: {
    heatNo: v.number(),
    raceDateTime: v.number(),
    rawHeatType: v.string(),
    heatCategory: heatCategoryValidator,
    resultMode: v.union(v.literal("individual"), v.literal("team"), v.literal("unknown")),
    status: v.union(v.literal("scraped"), v.literal("empty"), v.literal("error")),
    winnerRaw: v.optional(v.string()),
    entries: v.array(heatEntryInput),
  },
  handler: async (ctx, args) => {
    const existingHeat = await ctx.db
      .query("heats")
      .withIndex("by_heatNo", (q) => q.eq("heatNo", args.heatNo))
      .unique();

    const oldEntries = existingHeat
      ? await ctx.db
          .query("heatEntries")
          .withIndex("by_heat", (q) => q.eq("heatId", existingHeat._id))
          .collect()
      : [];

    let heatId: Id<"heats">;
    if (existingHeat) {
      await ctx.db.patch(existingHeat._id, {
        raceDateTime: args.raceDateTime,
        rawHeatType: args.rawHeatType,
        heatCategory: args.heatCategory,
        resultMode: args.resultMode,
        status: args.status,
        winnerRaw: args.winnerRaw,
        numEntries: args.entries.length,
        scrapedAt: Date.now(),
      });
      heatId = existingHeat._id;
    } else {
      heatId = await ctx.db.insert("heats", {
        heatNo: args.heatNo,
        raceDateTime: args.raceDateTime,
        rawHeatType: args.rawHeatType,
        heatCategory: args.heatCategory,
        resultMode: args.resultMode,
        status: args.status,
        winnerRaw: args.winnerRaw,
        numEntries: args.entries.length,
        scrapedAt: Date.now(),
      });
    }

    const touchedDriverIds = new Set<Id<"drivers">>();
    for (const oe of oldEntries) {
      if (oe.driverId) touchedDriverIds.add(oe.driverId);
      await ctx.db.delete(oe._id);
    }

    let newDriverCount = 0;
    let newLapsSum = 0;
    for (const entry of args.entries) {
      let driverId: Id<"drivers"> | undefined;
      if (entry.custId) {
        const driver = await ctx.db
          .query("drivers")
          .withIndex("by_custId", (q) => q.eq("custId", entry.custId!))
          .unique();
        if (!driver) {
          driverId = await ctx.db.insert("drivers", {
            custId: entry.custId,
            displayName: entry.driverNameRaw,
            nameVariantsSeen: [entry.driverNameRaw],
            isWatched: false,
            totalHeats: 0,
            totalLaps: 0,
            firstSeenHeatNo: args.heatNo,
            lastSeenHeatNo: args.heatNo,
          });
          newDriverCount++;
          await ctx.scheduler.runAfter(0, internal.actions.backfillDriver.run, {
            driverId,
            custId: entry.custId,
          });
        } else {
          driverId = driver._id;
          if (!driver.nameVariantsSeen.includes(entry.driverNameRaw)) {
            await ctx.db.patch(driver._id, {
              nameVariantsSeen: [...driver.nameVariantsSeen, entry.driverNameRaw],
            });
          }
        }
        touchedDriverIds.add(driverId);
      }

      newLapsSum += entry.numLaps;
      await ctx.db.insert("heatEntries", {
        heatId,
        heatNo: args.heatNo,
        heatCategory: args.heatCategory,
        driverId,
        driverNameRaw: entry.driverNameRaw,
        teamName: entry.teamName,
        position: entry.position,
        kartNo: undefined,
        bestLapMs: entry.bestLapMs,
        gapFromLeaderMs: entry.gapFromLeaderMs,
        numLaps: entry.numLaps,
        avgLapMs: entry.avgLapMs,
        proSkill: entry.proSkill,
        laps: entry.laps,
      });
    }

    for (const driverId of touchedDriverIds) {
      await recomputeDriverAggregates(ctx, driverId);
    }

    const oldLapsSum = oldEntries.reduce((sum, e) => sum + e.numLaps, 0);
    const lapsDelta = newLapsSum - oldLapsSum;
    const wasScraped = existingHeat?.status === "scraped";
    const heatsDelta = !wasScraped && args.status === "scraped" ? 1 : 0;

    let stats = await ctx.db.query("appStats").first();
    if (!stats) {
      const id = await ctx.db.insert("appStats", {
        totalHeatsScraped: 0,
        totalDrivers: 0,
        totalLaps: 0,
        maxHeatNo: 0,
        updatedAt: Date.now(),
      });
      stats = await ctx.db.get(id);
    }
    await ctx.db.patch(stats!._id, {
      totalHeatsScraped: stats!.totalHeatsScraped + heatsDelta,
      totalDrivers: stats!.totalDrivers + newDriverCount,
      totalLaps: stats!.totalLaps + lapsDelta,
      maxHeatNo: Math.max(stats!.maxHeatNo, args.heatNo),
      minHeatDate:
        stats!.minHeatDate !== undefined
          ? Math.min(stats!.minHeatDate, args.raceDateTime)
          : args.raceDateTime,
      maxHeatDate:
        stats!.maxHeatDate !== undefined
          ? Math.max(stats!.maxHeatDate, args.raceDateTime)
          : args.raceDateTime,
      updatedAt: Date.now(),
    });

    return { heatId, isNewHeat: !existingHeat };
  },
});

export const logScrapeError = internalMutation({
  args: {
    heatNo: v.number(),
    stage: v.union(v.literal("fetch"), v.literal("parse"), v.literal("write")),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("heatScrapeErrors", {
      heatNo: args.heatNo,
      attemptedAt: Date.now(),
      stage: args.stage,
      errorMessage: args.errorMessage,
    });
  },
});

export const listRecentErrors = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    return await ctx.db
      .query("heatScrapeErrors")
      .withIndex("by_attemptedAt")
      .order("desc")
      .take(limit ?? 50);
  },
});

export const listDistinctErrorHeatNos = internalQuery({
  args: {},
  handler: async (ctx) => {
    const errors = await ctx.db.query("heatScrapeErrors").collect();
    return [...new Set(errors.map((e) => e.heatNo))].sort((a, b) => a - b);
  },
});

export const countHeatsBefore = internalQuery({
  args: { cutoffHeatNo: v.number() },
  handler: async (ctx, { cutoffHeatNo }) => {
    const heats = await ctx.db
      .query("heats")
      .withIndex("by_heatNo", (q) => q.lt("heatNo", cutoffHeatNo))
      .collect();
    return { heatCount: heats.length };
  },
});

/** Deletes up to `batchSize` heats (oldest first) below cutoffHeatNo, their
 * entries, and recomputes/prunes affected drivers. Call repeatedly until
 * `hasMore` is false; a final appStats fixup runs separately (see
 * `finalizeStatsAfterPurge`) since minHeatDate can't be maintained
 * incrementally without a full scan. */
export const purgeHeatsBeforeBatch = internalMutation({
  args: { cutoffHeatNo: v.number(), batchSize: v.number() },
  handler: async (ctx, { cutoffHeatNo, batchSize }) => {
    const heats = await ctx.db
      .query("heats")
      .withIndex("by_heatNo", (q) => q.lt("heatNo", cutoffHeatNo))
      .take(batchSize);

    const touchedDriverIds = new Set<Id<"drivers">>();
    let lapsDeleted = 0;
    let heatsScrapedDeleted = 0;

    for (const heat of heats) {
      if (heat.status === "scraped") heatsScrapedDeleted++;
      const entries = await ctx.db
        .query("heatEntries")
        .withIndex("by_heat", (q) => q.eq("heatId", heat._id))
        .collect();
      for (const entry of entries) {
        if (entry.driverId) touchedDriverIds.add(entry.driverId);
        lapsDeleted += entry.numLaps;
        await ctx.db.delete(entry._id);
      }
      await ctx.db.delete(heat._id);

      const errors = await ctx.db
        .query("heatScrapeErrors")
        .withIndex("by_heatNo", (q) => q.eq("heatNo", heat.heatNo))
        .collect();
      for (const err of errors) await ctx.db.delete(err._id);
    }

    let driversDeleted = 0;
    for (const driverId of touchedDriverIds) {
      await recomputeDriverAggregates(ctx, driverId);
      const driver = await ctx.db.get(driverId);
      if (driver && driver.totalHeats === 0 && !driver.mergedIntoDriverId) {
        await ctx.db.delete(driverId);
        driversDeleted++;
      }
    }

    const stats = await ctx.db.query("appStats").first();
    if (stats) {
      await ctx.db.patch(stats._id, {
        totalHeatsScraped: Math.max(0, stats.totalHeatsScraped - heatsScrapedDeleted),
        totalLaps: Math.max(0, stats.totalLaps - lapsDeleted),
        totalDrivers: Math.max(0, stats.totalDrivers - driversDeleted),
        updatedAt: Date.now(),
      });
    }

    return { deletedCount: heats.length, hasMore: heats.length === batchSize };
  },
});

/** Recomputes appStats.minHeatDate/maxHeatDate from scratch via cheap indexed
 * boundary queries (not a full scan) - run once after all purge batches. */
export const finalizeStatsAfterPurge = internalMutation({
  args: {},
  handler: async (ctx) => {
    const stats = await ctx.db.query("appStats").first();
    if (!stats) return;
    const earliest = await ctx.db.query("heats").withIndex("by_date").order("asc").first();
    const latest = await ctx.db.query("heats").withIndex("by_date").order("desc").first();
    await ctx.db.patch(stats._id, {
      minHeatDate: earliest?.raceDateTime,
      maxHeatDate: latest?.raceDateTime,
      updatedAt: Date.now(),
    });
  },
});
