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

// If ClubSpeed pre-reserves a long block of heat numbers (returning "not
// allocated yet" for far more than CONSECUTIVE_MISS_LIMIT in a row), the
// batch loop can mistake that block for having caught up to the live edge
// and keep sailing forward, batch after batch, without ever producing a
// real "scraped"/"empty" result - silently polling empty space forever
// instead of the real backlog behind it. If the cursor drifts this far past
// the last confirmed real heat with zero genuine progress, stop and disable
// scraping rather than continuing to run away unattended.
const MAX_LIVE_EDGE_OVERRUN = 1000;
const EMPTY_RECHECK_RESCHEDULE_MS = 30 * 60 * 1000;
const EMPTY_RECHECK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const EMPTY_RECHECK_BATCH_SIZE = 100;
const MISS_RECHECK_RESCHEDULE_MS = 15 * 60 * 1000;
const MISS_RECHECK_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MISS_RECHECK_BATCH_SIZE = 200;

// A batch can take longer than expected under network/retry pressure; give
// it a generous margin before another caller is allowed to treat it as dead.
const SCRAPE_CHAIN_KEY = "scrapeBatchChain";
const SCRAPE_CHAIN_STALE_MS = 3 * 60 * 1000;
const EMPTY_RECHECK_CHAIN_KEY = "recheckEmptyHeatsChain";
const EMPTY_RECHECK_CHAIN_STALE_MS = 10 * 60 * 1000;
const MISS_RECHECK_CHAIN_KEY = "recheckMissedHeatsChain";
const MISS_RECHECK_CHAIN_STALE_MS = 10 * 60 * 1000;

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
    // ServerError.html redirect - not allocated *yet*. ClubSpeed appears to
    // pre-reserve heat numbers before their results page goes live, so this
    // isn't necessarily permanent; track it for recheckMissedHeats to retry.
    await ctx.runMutation(internal.heats.recordMiss, { heatNo });
    return "invalid";
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
  let payload: ReturnType<typeof parseHeatDetailsHtml>;
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
    payload = parsed;
  } catch (err) {
    await ctx.runMutation(internal.heats.logScrapeError, {
      heatNo,
      stage: "parse",
      errorMessage: String(err),
    });
    return "error";
  }

  try {
    const { category, resultModeHint } = categorizeHeatType(payload.rawHeatType);
    const isEmpty = payload.results.length === 0 && payload.winnerRaw === "-";

    const entries = payload.results.map((r) => {
      const laps = r.name ? payload.lapsByName.get(r.name) ?? [] : [];
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
      raceDateTime: payload.raceDateTime,
      rawHeatType: payload.rawHeatType,
      heatCategory: category,
      resultMode,
      status: isEmpty ? "empty" : "scraped",
      winnerRaw: payload.winnerRaw,
      entries,
    });
    await ctx.runMutation(internal.heats.clearMiss, { heatNo });

    return isEmpty ? "empty" : "scraped";
  } catch (err) {
    await ctx.runMutation(internal.heats.logScrapeError, {
      heatNo,
      stage: "write",
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
 *
 * Guarded by an owner-token lock (see appSettings.claimChainIfIdle) so that
 * a fresh trigger - the cron watchdog, a redeploy re-firing that watchdog,
 * or "run batch now" - can never run alongside an already-live chain. A
 * continuing link (one that already holds the token) always proceeds; only
 * a *new* chain has to prove the previous owner is actually dead first.
 */
export const scrapeBatch = internalAction({
  args: { chainToken: v.optional(v.string()) },
  handler: async (ctx, { chainToken }) => {
    const enabled = await ctx.runQuery(internal.appSettings.getInternal, { key: "scrapingEnabled" });
    if (enabled === false) return;

    let myToken = chainToken;
    if (myToken) {
      const stillOwner = await ctx.runMutation(internal.appSettings.heartbeatIfOwner, {
        key: SCRAPE_CHAIN_KEY,
        token: myToken,
      });
      if (!stillOwner) return; // superseded by a newer chain; let this one die quietly
    } else {
      myToken = crypto.randomUUID();
      const claimed = await ctx.runMutation(internal.appSettings.claimChainIfIdle, {
        key: SCRAPE_CHAIN_KEY,
        newToken: myToken,
        staleAfterMs: SCRAPE_CHAIN_STALE_MS,
      });
      if (!claimed) return; // a live chain already owns this; don't run a duplicate
    }

    const cursorValue = await ctx.runQuery(internal.appSettings.getInternal, { key: "backfillCursor" });
    let heatNo = typeof cursorValue === "number" ? cursorValue : 1;

    let consecutiveMisses = 0;
    let processed = 0;
    let sawRealProgress = false;
    while (processed < BATCH_SIZE && consecutiveMisses < CONSECUTIVE_MISS_LIMIT) {
      const outcome = await scrapeAndStoreHeat(ctx, heatNo);
      consecutiveMisses = outcome === "invalid" ? consecutiveMisses + 1 : 0;
      if (outcome === "scraped" || outcome === "empty") sawRealProgress = true;
      heatNo++;
      processed++;
      await sleep(REQUEST_DELAY_MS);
    }

    const stats = await ctx.runQuery(internal.appSettings.statsInternal, {});
    const overrun = stats ? heatNo - stats.maxHeatNo : 0;
    if (!sawRealProgress && overrun > MAX_LIVE_EDGE_OVERRUN) {
      // Cursor has drifted far past the last real heat with nothing to show
      // for it - stop burning through heat numbers and require a human to
      // look, instead of polling empty space indefinitely.
      await ctx.runMutation(internal.heats.logScrapeError, {
        heatNo,
        stage: "write",
        errorMessage: `Auto-paused: cursor overran maxHeatNo by ${overrun} (> ${MAX_LIVE_EDGE_OVERRUN}) with no scraped/empty results in this batch. Backfill cursor left at ${heatNo}.`,
      });
      await ctx.runMutation(internal.appSettings.setInternal, { key: "scrapingEnabled", value: false });
      await ctx.runMutation(internal.appSettings.setInternal, { key: "backfillCursor", value: heatNo });
      return;
    }

    await ctx.runMutation(internal.appSettings.setInternal, { key: "backfillCursor", value: heatNo });

    const reachedLiveEdge = consecutiveMisses >= CONSECUTIVE_MISS_LIMIT;
    await ctx.scheduler.runAfter(
      reachedLiveEdge ? CAUGHT_UP_RESCHEDULE_MS : BACKFILL_RESCHEDULE_MS,
      internal.actions.scrapeHeats.scrapeBatch,
      { chainToken: myToken },
    );
  },
});

/**
 * Separate self-rescheduling loop that revisits "empty" (scheduled but not
 * yet raced) heats so results appear once ClubSpeed posts them, without
 * re-walking the entire dataset. Same owner-token guard as scrapeBatch.
 */
export const recheckEmptyHeats = internalAction({
  args: { chainToken: v.optional(v.string()) },
  handler: async (ctx, { chainToken }) => {
    const enabled = await ctx.runQuery(internal.appSettings.getInternal, { key: "scrapingEnabled" });
    if (enabled === false) return;

    let myToken = chainToken;
    if (myToken) {
      const stillOwner = await ctx.runMutation(internal.appSettings.heartbeatIfOwner, {
        key: EMPTY_RECHECK_CHAIN_KEY,
        token: myToken,
      });
      if (!stillOwner) return;
    } else {
      myToken = crypto.randomUUID();
      const claimed = await ctx.runMutation(internal.appSettings.claimChainIfIdle, {
        key: EMPTY_RECHECK_CHAIN_KEY,
        newToken: myToken,
        staleAfterMs: EMPTY_RECHECK_CHAIN_STALE_MS,
      });
      if (!claimed) return;
    }

    const emptyHeats = await ctx.runQuery(internal.heats.listEmptyForRecheck, {
      maxAgeMs: EMPTY_RECHECK_MAX_AGE_MS,
      limit: EMPTY_RECHECK_BATCH_SIZE,
    });

    for (const heat of emptyHeats) {
      await scrapeAndStoreHeat(ctx, heat.heatNo);
      await sleep(REQUEST_DELAY_MS);
    }

    await ctx.scheduler.runAfter(EMPTY_RECHECK_RESCHEDULE_MS, internal.actions.scrapeHeats.recheckEmptyHeats, {
      chainToken: myToken,
    });
  },
});

/**
 * Separate self-rescheduling loop that retries heat numbers previously seen
 * as "not allocated yet" (see recordMiss in convex/heats.ts). scrapeBatch's
 * live-edge catch-up abandons a heat number forever once it's scanned past
 * it, but ClubSpeed pre-reserves numbers before their results page actually
 * goes live - so a miss isn't permanent. This loop gives those numbers a
 * chance to resolve without re-walking the whole cursor. Misses older than
 * MISS_RECHECK_MAX_AGE_MS are assumed genuinely abandoned and dropped.
 * Same owner-token guard as the other chains.
 */
export const recheckMissedHeats = internalAction({
  args: { chainToken: v.optional(v.string()) },
  handler: async (ctx, { chainToken }) => {
    const enabled = await ctx.runQuery(internal.appSettings.getInternal, { key: "scrapingEnabled" });
    if (enabled === false) return;

    let myToken = chainToken;
    if (myToken) {
      const stillOwner = await ctx.runMutation(internal.appSettings.heartbeatIfOwner, {
        key: MISS_RECHECK_CHAIN_KEY,
        token: myToken,
      });
      if (!stillOwner) return;
    } else {
      myToken = crypto.randomUUID();
      const claimed = await ctx.runMutation(internal.appSettings.claimChainIfIdle, {
        key: MISS_RECHECK_CHAIN_KEY,
        newToken: myToken,
        staleAfterMs: MISS_RECHECK_CHAIN_STALE_MS,
      });
      if (!claimed) return;
    }

    const misses = await ctx.runQuery(internal.heats.listMissesForRecheck, {
      limit: MISS_RECHECK_BATCH_SIZE,
    });

    const cutoff = Date.now() - MISS_RECHECK_MAX_AGE_MS;
    for (const miss of misses) {
      if (miss.firstMissedAt < cutoff) {
        await ctx.runMutation(internal.heats.clearMiss, { heatNo: miss.heatNo });
        continue;
      }
      await scrapeAndStoreHeat(ctx, miss.heatNo);
      await sleep(REQUEST_DELAY_MS);
    }

    await ctx.scheduler.runAfter(MISS_RECHECK_RESCHEDULE_MS, internal.actions.scrapeHeats.recheckMissedHeats, {
      chainToken: myToken,
    });
  },
});
