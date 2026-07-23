import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalMutation, internalAction, action, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireAdmin } from "./lib/adminAuth";
import { pacificPartsForUtc, WEEKLY_HOURS } from "./lib/trackSchedule";
import { isoWeekOf } from "./lib/isoWeek";

const SLOT_MINUTES = 15;
const CLEAR_BATCH_SIZE = 500;
const REBUILD_BATCH_SIZE = 500;

function slotStart(hour: number, minute: number): number {
  return Math.floor((hour * 60 + minute) / SLOT_MINUTES) * SLOT_MINUTES;
}

/** Deletes up to CLEAR_BATCH_SIZE rows from each race-time table. Called repeatedly until it reports nothing left. */
export const clearBucketsBatch = internalMutation({
  args: {},
  handler: async (ctx) => {
    let cleared = 0;
    for (const table of ["raceTimeBuckets", "raceTimeBucketsByWeek", "raceTimeWeeks"] as const) {
      const rows = await ctx.db.query(table).take(CLEAR_BATCH_SIZE);
      for (const row of rows) await ctx.db.delete(row._id);
      cleared += rows.length;
    }
    return { cleared };
  },
});

/**
 * Rebuilds race-time buckets from one page of arrive-and-drive heats. Each
 * heat only costs a handful of small indexed reads/writes (O(1), unlike the
 * O(heat size^2) driverRivalries backfill), so a generous batch size stays
 * safely under the per-mutation read/write limit.
 */
export const rebuildBucketsBatch = internalMutation({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const result = await ctx.db
      .query("heats")
      .withIndex("by_category", (q) => q.eq("heatCategory", "arrive_and_drive"))
      .paginate(paginationOpts);

    for (const heat of result.page) {
      const parts = pacificPartsForUtc(heat.raceDateTime);
      const slot = slotStart(parts.hour, parts.minute);
      const { isoYear, isoWeek, weekStartMs } = isoWeekOf(parts.year, parts.month, parts.day);

      const allTime = await ctx.db
        .query("raceTimeBuckets")
        .withIndex("by_weekday_slot", (q) => q.eq("weekday", parts.weekday).eq("slotStartMinute", slot))
        .unique();
      if (allTime) {
        await ctx.db.patch(allTime._id, {
          heatCount: allTime.heatCount + 1,
          totalEntries: allTime.totalEntries + heat.numEntries,
        });
      } else {
        await ctx.db.insert("raceTimeBuckets", {
          weekday: parts.weekday,
          slotStartMinute: slot,
          heatCount: 1,
          totalEntries: heat.numEntries,
        });
      }

      const perWeek = await ctx.db
        .query("raceTimeBucketsByWeek")
        .withIndex("by_week_weekday_slot", (q) =>
          q.eq("isoYear", isoYear).eq("isoWeek", isoWeek).eq("weekday", parts.weekday).eq("slotStartMinute", slot),
        )
        .unique();
      if (perWeek) {
        await ctx.db.patch(perWeek._id, {
          heatCount: perWeek.heatCount + 1,
          totalEntries: perWeek.totalEntries + heat.numEntries,
        });
      } else {
        await ctx.db.insert("raceTimeBucketsByWeek", {
          isoYear,
          isoWeek,
          weekday: parts.weekday,
          slotStartMinute: slot,
          heatCount: 1,
          totalEntries: heat.numEntries,
        });
      }

      const weekRow = await ctx.db
        .query("raceTimeWeeks")
        .withIndex("by_year_week", (q) => q.eq("isoYear", isoYear).eq("isoWeek", isoWeek))
        .unique();
      if (!weekRow) {
        await ctx.db.insert("raceTimeWeeks", { isoYear, isoWeek, weekStartMs });
      }
    }

    return { isDone: result.isDone, continueCursor: result.continueCursor, processedCount: result.page.length };
  },
});

/**
 * Full clear-then-rebuild of every race-time table, orchestrated from an
 * action so each individual clear/rebuild mutation stays small and bounded
 * regardless of total heat count - see the driverRivalries incident this was
 * modeled to avoid repeating.
 */
export const recomputeRaceTimeBuckets = internalAction({
  args: {},
  handler: async (ctx) => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { cleared } = await ctx.runMutation(internal.raceTimes.clearBucketsBatch, {});
      if (cleared === 0) break;
    }

    let cursor: string | null = null;
    let isDone = false;
    while (!isDone) {
      const result: { isDone: boolean; continueCursor: string; processedCount: number } = await ctx.runMutation(
        internal.raceTimes.rebuildBucketsBatch,
        { paginationOpts: { numItems: REBUILD_BATCH_SIZE, cursor } },
      );
      isDone = result.isDone;
      cursor = result.continueCursor;
    }
  },
});

/** Admin-only: force a recompute right now instead of waiting for the nightly cron. */
export const adminRecomputeNow = action({
  args: { adminSecret: v.string() },
  handler: async (ctx, { adminSecret }) => {
    requireAdmin(adminSecret);
    await ctx.runAction(internal.raceTimes.recomputeRaceTimeBuckets, {});
  },
});

/** All-time buckets, or a single ISO week's buckets when isoYear/isoWeek are both given. */
export const getRaceTimeBuckets = query({
  args: { adminSecret: v.string(), isoYear: v.optional(v.number()), isoWeek: v.optional(v.number()) },
  handler: async (ctx, { adminSecret, isoYear, isoWeek }) => {
    requireAdmin(adminSecret);
    if (isoYear !== undefined && isoWeek !== undefined) {
      return await ctx.db
        .query("raceTimeBucketsByWeek")
        .withIndex("by_week_weekday_slot", (q) => q.eq("isoYear", isoYear).eq("isoWeek", isoWeek))
        .collect();
    }
    return await ctx.db.query("raceTimeBuckets").collect();
  },
});

/**
 * The track's published weekly open/close hours (not admin-gated - it's
 * public schedule info). Lets the frontend generate the full expected list
 * of 15-minute slots per day without needing to import convex/lib/
 * trackSchedule.ts directly, which transitively pulls in the cheerio
 * scraping dependency that has no business in the browser bundle.
 */
export const getWeeklyHours = query({
  args: {},
  handler: async () => WEEKLY_HOURS,
});

/** Every ISO week that has arrive-and-drive data, newest first - populates the week-filter dropdown. */
export const listAvailableWeeks = query({
  args: { adminSecret: v.string() },
  handler: async (ctx, { adminSecret }) => {
    requireAdmin(adminSecret);
    const weeks = await ctx.db.query("raceTimeWeeks").collect();
    return weeks.sort((a, b) => b.weekStartMs - a.weekStartMs);
  },
});
