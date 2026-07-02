"use node";

import { v } from "convex/values";
import { internalAction, action } from "../_generated/server";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { CLUBSPEED_BASE, parseHeatDetailsHtml } from "../lib/clubspeedParser";
import { categorizeHeatType } from "../lib/heatType";
import { requireAdmin } from "../lib/adminAuth";

const BATCH_SIZE = 50;
const REQUEST_DELAY_MS = 400;
const CONSECUTIVE_MISS_LIMIT = 30;
const CAUGHT_UP_RESCHEDULE_MS = 3 * 60 * 1000;
const BACKFILL_RESCHEDULE_MS = 2 * 1000;
const EMPTY_RECHECK_RESCHEDULE_MS = 30 * 60 * 1000;
const EMPTY_RECHECK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const EMPTY_RECHECK_BATCH_SIZE = 100;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ScrapeOutcome = "scraped" | "empty" | "invalid" | "error";

async function scrapeAndStoreHeat(ctx: ActionCtx, heatNo: number): Promise<ScrapeOutcome> {
  let res: Response;
  try {
    res = await fetch(`${CLUBSPEED_BASE}/HeatDetails.aspx?HeatNo=${heatNo}`, {
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PGPTimesBot/1.0)" },
    });
  } catch (err) {
    await ctx.runMutation(internal.heats.logScrapeError, {
      heatNo,
      stage: "fetch",
      errorMessage: String(err),
    });
    return "error";
  }

  if (res.status >= 300 && res.status < 400) {
    return "invalid"; // ServerError.html redirect - heat number not allocated yet
  }
  if (!res.ok) {
    await ctx.runMutation(internal.heats.logScrapeError, {
      heatNo,
      stage: "fetch",
      errorMessage: `HTTP ${res.status}`,
    });
    return "error";
  }

  const html = await res.text();
  try {
    const parsed = parseHeatDetailsHtml(html);
    if (!parsed.rawHeatType) {
      await ctx.runMutation(internal.heats.logScrapeError, {
        heatNo,
        stage: "parse",
        errorMessage: "Missing #lblRaceType - unexpected page structure",
      });
      return "error";
    }

    const { category, resultModeHint } = categorizeHeatType(parsed.rawHeatType);
    const isEmpty = parsed.results.length === 0 && parsed.winnerRaw === "-";

    const entries = parsed.results.map((r) => {
      const laps = r.name ? parsed.lapsByName.get(r.name) ?? [] : [];
      return {
        driverNameRaw: r.name ?? r.teamName ?? "Unknown",
        custId: r.custId,
        teamName: r.teamName,
        position: r.position,
        bestLapMs: r.bestLapMs,
        gapFromLeaderMs: r.gapFromLeaderMs,
        numLaps: r.numLaps ?? laps.length,
        avgLapMs: r.avgLapMs,
        proSkill: r.proSkill,
        laps,
      };
    });

    const resultMode: "individual" | "team" | "unknown" = isEmpty
      ? "unknown"
      : entries.some((e) => e.teamName)
        ? "team"
        : resultModeHint === "unknown"
          ? "individual"
          : resultModeHint;

    await ctx.runMutation(internal.heats.upsertHeat, {
      heatNo,
      raceDateTime: parsed.raceDateTime,
      rawHeatType: parsed.rawHeatType,
      heatCategory: category,
      resultMode,
      status: isEmpty ? "empty" : "scraped",
      winnerRaw: parsed.winnerRaw,
      entries,
    });

    return isEmpty ? "empty" : "scraped";
  } catch (err) {
    await ctx.runMutation(internal.heats.logScrapeError, {
      heatNo,
      stage: "parse",
      errorMessage: String(err),
    });
    return "error";
  }
}

export const scrapeOneHeat = internalAction({
  args: { heatNo: v.number() },
  handler: async (ctx, { heatNo }) => {
    return await scrapeAndStoreHeat(ctx, heatNo);
  },
});

/** Admin-only: manually (re-)scrape a single heat number right now. */
export const adminScrapeHeat = action({
  args: { heatNo: v.number(), adminSecret: v.string() },
  handler: async (ctx, { heatNo, adminSecret }) => {
    requireAdmin(adminSecret);
    return await scrapeAndStoreHeat(ctx, heatNo);
  },
});

/** Admin-only: kick the self-rescheduling batch loop immediately instead of waiting for its next scheduled run. */
export const adminRunBatchNow = action({
  args: { adminSecret: v.string() },
  handler: async (ctx, { adminSecret }) => {
    requireAdmin(adminSecret);
    await ctx.runAction(internal.actions.scrapeHeats.scrapeBatch, {});
  },
});

/**
 * Self-rescheduling batch loop. Doubles as both the historical backfill
 * (fast cadence while there's still a backlog of un-scraped heat numbers)
 * and the ongoing live poll (slow cadence once it hits a run of consecutive
 * "not allocated yet" responses, i.e. it has caught up to the present).
 */
export const scrapeBatch = internalAction({
  args: {},
  handler: async (ctx) => {
    const enabled = await ctx.runQuery(internal.appSettings.getInternal, { key: "scrapingEnabled" });
    if (enabled === false) return;

    const cursorValue = await ctx.runQuery(internal.appSettings.getInternal, { key: "backfillCursor" });
    let heatNo = typeof cursorValue === "number" ? cursorValue : 1;

    let consecutiveMisses = 0;
    let processed = 0;
    while (processed < BATCH_SIZE && consecutiveMisses < CONSECUTIVE_MISS_LIMIT) {
      const outcome = await scrapeAndStoreHeat(ctx, heatNo);
      consecutiveMisses = outcome === "invalid" ? consecutiveMisses + 1 : 0;
      heatNo++;
      processed++;
      await sleep(REQUEST_DELAY_MS);
    }

    await ctx.runMutation(internal.appSettings.setInternal, { key: "backfillCursor", value: heatNo });

    const reachedLiveEdge = consecutiveMisses >= CONSECUTIVE_MISS_LIMIT;
    await ctx.scheduler.runAfter(
      reachedLiveEdge ? CAUGHT_UP_RESCHEDULE_MS : BACKFILL_RESCHEDULE_MS,
      internal.actions.scrapeHeats.scrapeBatch,
      {},
    );
  },
});

/**
 * Separate self-rescheduling loop that revisits "empty" (scheduled but not
 * yet raced) heats so results appear once ClubSpeed posts them, without
 * re-walking the entire dataset.
 */
export const recheckEmptyHeats = internalAction({
  args: {},
  handler: async (ctx) => {
    const enabled = await ctx.runQuery(internal.appSettings.getInternal, { key: "scrapingEnabled" });
    if (enabled === false) return;

    const emptyHeats = await ctx.runQuery(internal.heats.listEmptyForRecheck, {
      maxAgeMs: EMPTY_RECHECK_MAX_AGE_MS,
      limit: EMPTY_RECHECK_BATCH_SIZE,
    });

    for (const heat of emptyHeats) {
      await scrapeAndStoreHeat(ctx, heat.heatNo);
      await sleep(REQUEST_DELAY_MS);
    }

    await ctx.scheduler.runAfter(EMPTY_RECHECK_RESCHEDULE_MS, internal.actions.scrapeHeats.recheckEmptyHeats, {});
  },
});
