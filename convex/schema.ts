import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const heatCategoryValidator = v.union(
  v.literal("arrive_and_drive"),
  v.literal("league"),
  v.literal("pro_am"),
  v.literal("group_event"),
  v.literal("practice"),
  v.literal("endurance"),
  v.literal("other"),
);

export default defineSchema({
  drivers: defineTable({
    custId: v.string(),
    displayName: v.string(),
    nameVariantsSeen: v.array(v.string()),
    isWatched: v.boolean(),
    totalHeats: v.number(),
    totalLaps: v.number(),
    totalWins: v.optional(v.number()),
    totalPodiums: v.optional(v.number()),
    bestLapMs: v.optional(v.number()),
    bestLapHeatId: v.optional(v.id("heats")),
    bestLapByCategory: v.optional(
      v.record(v.string(), v.object({ lapMs: v.number(), heatId: v.id("heats") })),
    ),
    firstSeenHeatNo: v.number(),
    lastSeenHeatNo: v.number(),
    mergedIntoDriverId: v.optional(v.id("drivers")),
  })
    .index("by_custId", ["custId"])
    .index("by_watched", ["isWatched"])
    .index("by_bestLap", ["bestLapMs"])
    .searchIndex("search_displayName", { searchField: "displayName" }),

  heats: defineTable({
    heatNo: v.number(),
    raceDateTime: v.number(),
    rawHeatType: v.string(),
    heatCategory: heatCategoryValidator,
    resultMode: v.union(v.literal("individual"), v.literal("team"), v.literal("unknown")),
    status: v.union(v.literal("scraped"), v.literal("empty"), v.literal("error")),
    winnerRaw: v.optional(v.string()),
    numEntries: v.number(),
    scrapedAt: v.number(),
  })
    .index("by_heatNo", ["heatNo"])
    .index("by_status", ["status"])
    .index("by_category", ["heatCategory"])
    .index("by_date", ["raceDateTime"]),

  heatEntries: defineTable({
    heatId: v.id("heats"),
    heatNo: v.number(),
    heatCategory: v.string(),
    driverId: v.optional(v.id("drivers")),
    driverNameRaw: v.string(),
    teamName: v.optional(v.string()),
    position: v.number(),
    kartNo: v.optional(v.number()),
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
  })
    .index("by_heat", ["heatId"])
    .index("by_heatNo", ["heatNo"])
    .index("by_driver", ["driverId"])
    .index("by_driver_bestLap", ["driverId", "bestLapMs"])
    .index("by_category_bestLap", ["heatCategory", "bestLapMs"])
    .index("by_bestLap", ["bestLapMs"]),

  driverMerges: defineTable({
    sourceDriverId: v.id("drivers"),
    targetDriverId: v.id("drivers"),
    mergedAt: v.number(),
    reason: v.optional(v.string()),
  }).index("by_target", ["targetDriverId"]),

  heatScrapeErrors: defineTable({
    heatNo: v.number(),
    attemptedAt: v.number(),
    stage: v.union(v.literal("fetch"), v.literal("parse"), v.literal("write")),
    errorMessage: v.string(),
  })
    .index("by_heatNo", ["heatNo"])
    .index("by_attemptedAt", ["attemptedAt"]),

  heatMisses: defineTable({
    heatNo: v.number(),
    firstMissedAt: v.number(),
    lastCheckedAt: v.number(),
  }).index("by_heatNo", ["heatNo"]),

  appSettings: defineTable({
    key: v.string(),
    value: v.any(),
  }).index("by_key", ["key"]),

  appStats: defineTable({
    totalHeatsScraped: v.number(),
    totalDrivers: v.number(),
    totalLaps: v.number(),
    maxHeatNo: v.number(),
    minHeatDate: v.optional(v.number()),
    maxHeatDate: v.optional(v.number()),
    updatedAt: v.number(),
  }),
});
