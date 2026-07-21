import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id, Doc } from "./_generated/dataModel";
import { recomputeDriverAggregates } from "./drivers";
import { correctTrackLocalTimestamp } from "./lib/clubspeedParser";
import { MIN_VALID_LAP_MS } from "./lib/constants";
import { classifyWetness, MIN_ENTRIES_FOR_CLASSIFICATION } from "./lib/wetDetection";
import { requireAdmin } from "./lib/adminAuth";
import { parseYoutubeVideoId } from "./lib/youtube";

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

/**
 * One-time migration helper for the confirmedHeatCursor/scanHeatCursor split
 * (see scrapeHeats.ts's scrapeBatch). Steps backward one heatNo at a time via
 * the by_heatNo index (cheap point lookups, not a table scan) looking for the
 * last heat actually confirmed "scraped", bounded so it can never turn into
 * an unbounded scan. Only ever called once per deployment, right before the
 * new cursor keys are seeded for the first time.
 */
export const findLastScrapedHeatNoBefore = internalQuery({
  args: { notAfter: v.number(), maxStepsBack: v.number() },
  handler: async (ctx, { notAfter, maxStepsBack }) => {
    const floor = Math.max(1, notAfter - maxStepsBack);
    for (let n = notAfter; n >= floor; n--) {
      const heat = await ctx.db
        .query("heats")
        .withIndex("by_heatNo", (q) => q.eq("heatNo", n))
        .unique();
      if (heat?.status === "scraped") return n;
    }
    return null;
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

/** Records that `heatNo` came back "not allocated yet" so it can be retried
 * later - ClubSpeed appears to pre-reserve heat numbers before their results
 * page actually goes live, so a miss during the live-edge catch-up loop
 * doesn't mean the number will never be used. */
export const recordMiss = internalMutation({
  args: { heatNo: v.number() },
  handler: async (ctx, { heatNo }) => {
    const existing = await ctx.db
      .query("heatMisses")
      .withIndex("by_heatNo", (q) => q.eq("heatNo", heatNo))
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { lastCheckedAt: now });
    } else {
      await ctx.db.insert("heatMisses", { heatNo, firstMissedAt: now, lastCheckedAt: now });
    }
  },
});

/** Clears a heat's miss record once it's been successfully scraped (or found empty). */
export const clearMiss = internalMutation({
  args: { heatNo: v.number() },
  handler: async (ctx, { heatNo }) => {
    const existing = await ctx.db
      .query("heatMisses")
      .withIndex("by_heatNo", (q) => q.eq("heatNo", heatNo))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});

export const listMissesForRecheck = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    return await ctx.db.query("heatMisses").withIndex("by_heatNo").order("asc").take(limit);
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

    const laps: { heatNo: number; raceDateTime: number; lapNo: number; lapTimeMs: number; isWet: boolean }[] = [];
    for (const { entry, heat } of withDates) {
      if (!heat) continue;
      for (const lap of entry.laps) {
        laps.push({
          heatNo: entry.heatNo,
          raceDateTime: heat.raceDateTime,
          lapNo: lap.lapNo,
          lapTimeMs: lap.lapTimeMs,
          isWet: heat.isWet ?? false,
        });
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

const DATE_LEADERBOARD_MAX_HEATS = 500;
const DATE_LEADERBOARD_MAX_ENTRIES = 3000;

/** Date-scoped leaderboard: the one variant that can't use a driver's cached
 * all-time PB, since a PB field only ever holds the single best-ever value.
 * Bounded via heats.by_date first (never a full heatEntries collect - that
 * table has hundreds of thousands of rows, well past Convex's per-function
 * read limit), then reads each candidate heat's entries via heatEntries.by_heat. */
export const dateScopedLeaderboard = query({
  args: {
    category: v.optional(v.string()),
    fromMs: v.optional(v.number()),
    toMs: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { category, fromMs, toMs, limit }) => {
    const take = Math.min(limit ?? 100, 200);

    const heats = await ctx.db
      .query("heats")
      .withIndex("by_date", (q) => {
        if (fromMs !== undefined && toMs !== undefined) return q.gte("raceDateTime", fromMs).lte("raceDateTime", toMs);
        if (fromMs !== undefined) return q.gte("raceDateTime", fromMs);
        if (toMs !== undefined) return q.lte("raceDateTime", toMs);
        return q;
      })
      .take(DATE_LEADERBOARD_MAX_HEATS);

    const bestPerDriver = new Map<string, { entry: Doc<"heatEntries">; heat: Doc<"heats"> }>();
    let entriesScanned = 0;
    for (const heat of heats) {
      if (category && heat.heatCategory !== category) continue;
      if (entriesScanned >= DATE_LEADERBOARD_MAX_ENTRIES) break;
      const entries = await ctx.db
        .query("heatEntries")
        .withIndex("by_heat", (q) => q.eq("heatId", heat._id))
        .collect();
      entriesScanned += entries.length;
      for (const e of entries) {
        if (!e.driverId || e.bestLapMs === undefined || e.bestLapMs < MIN_VALID_LAP_MS) continue;
        const existing = bestPerDriver.get(e.driverId);
        if (!existing || (existing.entry.bestLapMs ?? Infinity) > e.bestLapMs) {
          bestPerDriver.set(e.driverId, { entry: e, heat });
        }
      }
    }

    const ranked = Array.from(bestPerDriver.values()).sort(
      (a, b) => (a.entry.bestLapMs ?? Infinity) - (b.entry.bestLapMs ?? Infinity),
    );

    const rows = await Promise.all(
      ranked.slice(0, take * 2).map(async (r) => ({
        entry: r.entry,
        heat: r.heat,
        driver: r.entry.driverId ? await ctx.db.get(r.entry.driverId) : null,
      })),
    );

    return rows.filter((r) => !r.driver?.mergedIntoDriverId).slice(0, take);
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

    // Admin-set wetness is sticky across rescrapes - only auto-classify when
    // there's no standing override. Leaving these fields out of the patch
    // below means an existing admin value is simply left untouched.
    let wetnessFields: {
      wetnessRatio?: number;
      isWet?: boolean;
      wetnessSource?: "auto" | "admin";
      wetClassifiedAt?: number;
    } = {};
    if (existingHeat?.wetnessSource !== "admin") {
      const baseline = await ctx.db
        .query("categoryDryBaselines")
        .withIndex("by_category", (q) => q.eq("heatCategory", args.heatCategory))
        .unique();
      const result = baseline
        ? classifyWetness(
            args.entries.map((e) => e.bestLapMs).filter((v): v is number => v !== undefined),
            args.entries.map((e) => e.avgLapMs).filter((v): v is number => v !== undefined),
            baseline.baselineFastLapMs,
            baseline.baselineFastAvgLapMs,
            MIN_VALID_LAP_MS,
          )
        : null;
      if (result) {
        wetnessFields = {
          wetnessRatio: result.bestLapRatio,
          isWet: result.isWet,
          wetnessSource: "auto",
          wetClassifiedAt: Date.now(),
        };
      }
    }

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
        ...wetnessFields,
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
        ...wetnessFields,
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

const TIMEZONE_FIX_DONE_KEY = "heatTimezonesFixedAt";

/** One-time correction for raceDateTime values computed before the Pacific
 * timezone parsing fix (see convex/lib/clubspeedParser.ts). Call repeatedly
 * with the previous response's `nextHeatNo` until `hasMore` is false, then
 * run `finalizeStatsAfterPurge` to fix appStats.min/maxHeatDate.
 *
 * This correction is NOT idempotent - applying it twice would double-shift
 * timestamps, including ones already fixed or freshly (correctly) scraped.
 * It locks itself out via appSettings once a batch reports hasMore: false. */
export const fixHeatTimezonesBatch = internalMutation({
  args: { afterHeatNo: v.optional(v.number()), batchSize: v.number() },
  handler: async (ctx, { afterHeatNo, batchSize }) => {
    const alreadyDone = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", TIMEZONE_FIX_DONE_KEY))
      .unique();
    if (alreadyDone) {
      return { nextHeatNo: afterHeatNo, hasMore: false, patchedCount: 0, skipped: "already run" };
    }

    const heats = await ctx.db
      .query("heats")
      .withIndex("by_heatNo", (q) =>
        afterHeatNo === undefined ? q : q.gt("heatNo", afterHeatNo),
      )
      .order("asc")
      .take(batchSize);

    let patchedCount = 0;
    for (const heat of heats) {
      const corrected = correctTrackLocalTimestamp(heat.raceDateTime);
      if (corrected !== heat.raceDateTime) {
        await ctx.db.patch(heat._id, { raceDateTime: corrected });
        patchedCount++;
      }
    }

    const hasMore = heats.length === batchSize;
    if (!hasMore) {
      await ctx.db.insert("appSettings", { key: TIMEZONE_FIX_DONE_KEY, value: Date.now() });
    }

    return {
      nextHeatNo: heats.length > 0 ? heats[heats.length - 1].heatNo : afterHeatNo,
      hasMore,
      patchedCount,
    };
  },
});

const WETNESS_BACKFILL_DONE_KEY = "wetnessBackfillDone";

/** One-time classification of every already-scraped heat, for history that
 * predates the wet-detection feature. Call repeatedly with the previous
 * response's `nextHeatNo` until `hasMore` is false. Requires
 * `wetDetection.recomputeCategoryBaselines` to have been run at least once
 * first, or heats will be skipped for lack of a baseline. Locks itself out
 * via appSettings once done, same as `fixHeatTimezonesBatch` above. */
export const backfillWetnessBatch = internalMutation({
  args: { afterHeatNo: v.optional(v.number()), batchSize: v.number() },
  handler: async (ctx, { afterHeatNo, batchSize }) => {
    const alreadyDone = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", WETNESS_BACKFILL_DONE_KEY))
      .unique();
    if (alreadyDone) {
      return { nextHeatNo: afterHeatNo, hasMore: false, classifiedCount: 0, skipped: "already run" };
    }

    const heats = await ctx.db
      .query("heats")
      .withIndex("by_heatNo", (q) => (afterHeatNo === undefined ? q : q.gt("heatNo", afterHeatNo)))
      .order("asc")
      .take(batchSize);

    const baselineCache = new Map<string, Doc<"categoryDryBaselines"> | null>();
    async function getBaseline(category: string) {
      if (!baselineCache.has(category)) {
        const baseline = await ctx.db
          .query("categoryDryBaselines")
          .withIndex("by_category", (q) => q.eq("heatCategory", category))
          .unique();
        baselineCache.set(category, baseline);
      }
      return baselineCache.get(category)!;
    }

    let classifiedCount = 0;
    for (const heat of heats) {
      if (heat.status !== "scraped") continue;
      if (heat.wetnessSource === "admin") continue;
      if (heat.numEntries < MIN_ENTRIES_FOR_CLASSIFICATION) continue;

      const baseline = await getBaseline(heat.heatCategory);
      if (!baseline) continue;

      const entries = await ctx.db
        .query("heatEntries")
        .withIndex("by_heat", (q) => q.eq("heatId", heat._id))
        .collect();
      const result = classifyWetness(
        entries.map((e) => e.bestLapMs).filter((v): v is number => v !== undefined),
        entries.map((e) => e.avgLapMs).filter((v): v is number => v !== undefined),
        baseline.baselineFastLapMs,
        baseline.baselineFastAvgLapMs,
        MIN_VALID_LAP_MS,
      );
      if (result) {
        await ctx.db.patch(heat._id, {
          wetnessRatio: result.bestLapRatio,
          isWet: result.isWet,
          wetnessSource: "auto",
          wetClassifiedAt: Date.now(),
        });
        classifiedCount++;
      }
    }

    const hasMore = heats.length === batchSize;
    if (!hasMore) {
      await ctx.db.insert("appSettings", { key: WETNESS_BACKFILL_DONE_KEY, value: Date.now() });
    }

    return {
      nextHeatNo: heats.length > 0 ? heats[heats.length - 1].heatNo : afterHeatNo,
      hasMore,
      classifiedCount,
    };
  },
});

/** Admin correction for a mis-classified heat. Sticky across rescrapes -
 * upsertHeat won't overwrite an admin-sourced value. */
export const setWetnessOverride = mutation({
  args: { heatId: v.id("heats"), isWet: v.boolean(), adminSecret: v.string() },
  handler: async (ctx, { heatId, isWet, adminSecret }) => {
    requireAdmin(adminSecret);
    await ctx.db.patch(heatId, { isWet, wetnessSource: "admin", wetClassifiedAt: Date.now() });
  },
});

/** Relinquishes an admin override, re-running the normal auto-classification
 * against the heat's current entries and cached category baseline so it
 * isn't left stale until the next rescrape happens to touch it. */
export const clearWetnessOverride = mutation({
  args: { heatId: v.id("heats"), adminSecret: v.string() },
  handler: async (ctx, { heatId, adminSecret }) => {
    requireAdmin(adminSecret);
    const heat = await ctx.db.get(heatId);
    if (!heat) throw new Error("Heat not found");

    const baseline = await ctx.db
      .query("categoryDryBaselines")
      .withIndex("by_category", (q) => q.eq("heatCategory", heat.heatCategory))
      .unique();
    if (!baseline) {
      await ctx.db.patch(heatId, {
        isWet: undefined,
        wetnessRatio: undefined,
        wetnessSource: undefined,
        wetClassifiedAt: undefined,
      });
      return;
    }

    const entries = await ctx.db
      .query("heatEntries")
      .withIndex("by_heat", (q) => q.eq("heatId", heatId))
      .collect();
    const result = classifyWetness(
      entries.map((e) => e.bestLapMs).filter((v): v is number => v !== undefined),
      entries.map((e) => e.avgLapMs).filter((v): v is number => v !== undefined),
      baseline.baselineFastLapMs,
      baseline.baselineFastAvgLapMs,
      MIN_VALID_LAP_MS,
    );
    await ctx.db.patch(heatId, {
      wetnessRatio: result?.bestLapRatio,
      isWet: result?.isWet,
      wetnessSource: result ? "auto" : undefined,
      wetClassifiedAt: result ? Date.now() : undefined,
    });
  },
});

/** Admin-set YouTube link for a heat. Re-parses and validates the pasted URL
 * server-side (never trusts client-side validation) and replaces any
 * existing link. */
export const setHeatVideo = mutation({
  args: {
    heatId: v.id("heats"),
    url: v.string(),
    slot: v.optional(v.union(v.literal(1), v.literal(2))),
    adminSecret: v.string(),
  },
  handler: async (ctx, { heatId, url, slot, adminSecret }) => {
    requireAdmin(adminSecret);
    const videoId = parseYoutubeVideoId(url);
    if (!videoId) {
      throw new Error("Couldn't find a valid YouTube video ID in that URL.");
    }
    if (slot === 2) {
      await ctx.db.patch(heatId, { youtubeVideoId2: videoId, youtubeAddedAt2: Date.now() });
    } else {
      await ctx.db.patch(heatId, { youtubeVideoId: videoId, youtubeAddedAt: Date.now() });
    }
  },
});

/** Removes an admin-set YouTube link from a heat. */
export const clearHeatVideo = mutation({
  args: {
    heatId: v.id("heats"),
    slot: v.optional(v.union(v.literal(1), v.literal(2))),
    adminSecret: v.string(),
  },
  handler: async (ctx, { heatId, slot, adminSecret }) => {
    requireAdmin(adminSecret);
    if (slot === 2) {
      await ctx.db.patch(heatId, { youtubeVideoId2: undefined, youtubeAddedAt2: undefined });
    } else {
      await ctx.db.patch(heatId, { youtubeVideoId: undefined, youtubeAddedAt: undefined });
    }
  },
});
