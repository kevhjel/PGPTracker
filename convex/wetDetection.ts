import { internalMutation } from "./_generated/server";
import { HEAT_CATEGORIES } from "./lib/heatType";
import { BASELINE_SAMPLE_SIZE, median } from "./lib/wetDetection";
import { MIN_VALID_LAP_MS } from "./lib/constants";

/**
 * Refreshes the "dry pace" reference per category from each category's
 * fastest-ever recorded entries (via the existing by_category_bestLap
 * index). Genuinely fast laps are essentially always set in dry
 * conditions, so this sample is naturally self-cleaning against wet-day
 * contamination without needing to know in advance which heats were wet.
 * Cost is bounded (7 categories x BASELINE_SAMPLE_SIZE docs), safely under
 * Convex's per-function read limit - see the leaderboard rewrite this
 * pattern is copied from (convex/drivers.ts: allTimeLeaderboard).
 */
export const recomputeCategoryBaselines = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const category of HEAT_CATEGORIES) {
      const fastest = await ctx.db
        .query("heatEntries")
        .withIndex("by_category_bestLap", (q) => q.eq("heatCategory", category).gte("bestLapMs", MIN_VALID_LAP_MS))
        .order("asc")
        .take(BASELINE_SAMPLE_SIZE);

      if (fastest.length < 3) continue; // not enough data yet for this category

      const baselineFastLapMs = median(fastest.map((e) => e.bestLapMs!))!;
      const avgLaps = fastest.map((e) => e.avgLapMs).filter((v): v is number => v !== undefined);
      const baselineFastAvgLapMs = avgLaps.length > 0 ? median(avgLaps)! : baselineFastLapMs;

      const existing = await ctx.db
        .query("categoryDryBaselines")
        .withIndex("by_category", (q) => q.eq("heatCategory", category))
        .unique();

      const value = {
        heatCategory: category,
        baselineFastLapMs,
        baselineFastAvgLapMs,
        sampleSize: fastest.length,
        computedAt: Date.now(),
      };
      if (existing) await ctx.db.patch(existing._id, value);
      else await ctx.db.insert("categoryDryBaselines", value);
    }
  },
});
