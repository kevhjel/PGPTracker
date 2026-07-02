"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { CLUBSPEED_BASE, parseRacerHistoryHtml } from "../lib/clubspeedParser";

function encodeCustId(custId: string): string {
  return Buffer.from(custId, "utf-8").toString("base64");
}

/**
 * Fetches a driver's full RacerHistory page (unpaginated, confirmed to
 * render 700+ heats in one response) to backfill their kart number per
 * heat (only available here, not on HeatDetails) and confirm their
 * canonical/untruncated display name. Runs async, non-blocking relative to
 * the main heat crawl.
 */
export const run = internalAction({
  args: { driverId: v.id("drivers"), custId: v.string() },
  handler: async (ctx, { driverId, custId }) => {
    const b64 = encodeCustId(custId);
    let res: Response;
    try {
      res = await fetch(`${CLUBSPEED_BASE}/RacerHistory.aspx?CustID=${b64}`, {
        redirect: "manual",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; PGPTimesBot/1.0)" },
      });
    } catch {
      return; // best-effort; the main crawl already has core data for this driver
    }
    if (!res.ok) return;

    const html = await res.text();
    const parsed = parseRacerHistoryHtml(html);

    await ctx.runMutation(internal.drivers.patchFromRacerHistory, {
      driverId,
      displayName: parsed.displayName || undefined,
      kartsByHeatNo: parsed.kartsByHeatNo,
    });
  },
});
