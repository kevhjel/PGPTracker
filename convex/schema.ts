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
    wetnessRatio: v.optional(v.number()),
    isWet: v.optional(v.boolean()),
    wetnessSource: v.optional(v.union(v.literal("auto"), v.literal("admin"))),
    wetClassifiedAt: v.optional(v.number()),
    youtubeVideoId: v.optional(v.string()),
    youtubeAddedAt: v.optional(v.number()),
    youtubeVideoId2: v.optional(v.string()),
    youtubeAddedAt2: v.optional(v.number()),
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

  driverRivalries: defineTable({
    driverId: v.id("drivers"),
    opponentId: v.id("drivers"),
    races: v.number(),
    wins: v.number(),
    losses: v.number(),
  })
    .index("by_driver_opponent", ["driverId", "opponentId"])
    .index("by_driver_races", ["driverId", "races"]),

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

  gpsSessions: defineTable({
    storageId: v.id("_storage"),
    fileName: v.string(),
    uploadedAt: v.number(),
    status: v.union(v.literal("pending"), v.literal("parsed"), v.literal("error")),
    errorMessage: v.optional(v.string()),
    lapCount: v.optional(v.number()),
  }).index("by_status", ["status"]),

  gpsLaps: defineTable({
    sessionId: v.id("gpsSessions"),
    lapIndex: v.number(),
    source: v.union(v.literal("trkseg"), v.literal("self_crossing"), v.literal("reference_crossing")),
    label: v.optional(v.string()),
    startTime: v.number(),
    endTime: v.number(),
    durationMs: v.number(),
    points: v.array(
      v.object({ lat: v.number(), lon: v.number(), t: v.number(), ele: v.optional(v.number()) }),
    ),
    projection: v.optional(
      v.object({
        referenceId: v.id("trackReference"),
        points: v.array(v.object({ distM: v.number(), t: v.number(), speedMps: v.optional(v.number()) })),
        sectorTimes: v.array(v.number()),
        lapTimeMsRefined: v.optional(v.number()),
      }),
    ),
  }).index("by_session", ["sessionId"]),

  trackReference: defineTable({
    sourceLapId: v.id("gpsLaps"),
    createdAt: v.number(),
    isActive: v.boolean(),
    originLat: v.number(),
    originLon: v.number(),
    totalDistanceM: v.number(),
    polyline: v.array(
      v.object({ distM: v.number(), lat: v.number(), lon: v.number(), x: v.number(), y: v.number() }),
    ),
    sectors: v.array(
      v.object({
        index: v.number(),
        type: v.union(v.literal("corner"), v.literal("straight")),
        startDistM: v.number(),
        endDistM: v.number(),
      }),
    ),
    buildParams: v.object({
      resampleSpacingM: v.number(),
      curvatureThresholdRadPerM: v.number(),
      minSegmentLengthM: v.number(),
    }),
  }).index("by_active", ["isActive"]),

  trackBounds: defineTable({
    createdAt: v.number(),
    isActive: v.boolean(),
    sourceFormat: v.union(v.literal("geojson"), v.literal("gpx")),
    outline: v.optional(v.array(v.object({ lat: v.number(), lon: v.number() }))),
    innerEdge: v.optional(v.array(v.object({ lat: v.number(), lon: v.number() }))),
    outerEdge: v.optional(v.array(v.object({ lat: v.number(), lon: v.number() }))),
  }).index("by_active", ["isActive"]),

  appSettings: defineTable({
    key: v.string(),
    value: v.any(),
  }).index("by_key", ["key"]),

  categoryDryBaselines: defineTable({
    heatCategory: v.string(),
    baselineFastLapMs: v.number(),
    baselineFastAvgLapMs: v.number(),
    sampleSize: v.number(),
    computedAt: v.number(),
  }).index("by_category", ["heatCategory"]),

  // All-time drivers-per-heat histogram data (arrive-and-drive only), bucketed
  // by weekday x 15-minute time-of-day slot. Precomputed by a full nightly
  // rebuild (convex/raceTimes.ts) rather than queried live, since a live scan
  // of the whole heats table risks the same per-function read limit hit by
  // the earlier driverRivalries incident.
  raceTimeBuckets: defineTable({
    weekday: v.number(), // 0=Sunday..6=Saturday, Pacific local (matches trackSchedule.ts)
    slotStartMinute: v.number(), // minutes since Pacific midnight, floored to 15
    heatCount: v.number(),
    totalEntries: v.number(), // sum of heats.numEntries; avg = totalEntries / heatCount
  }).index("by_weekday_slot", ["weekday", "slotStartMinute"]),

  // Same shape as raceTimeBuckets, additionally split out per ISO week so the
  // admin UI can filter the histogram to a single week instead of all-time.
  raceTimeBucketsByWeek: defineTable({
    isoYear: v.number(),
    isoWeek: v.number(),
    weekday: v.number(),
    slotStartMinute: v.number(),
    heatCount: v.number(),
    totalEntries: v.number(),
  }).index("by_week_weekday_slot", ["isoYear", "isoWeek", "weekday", "slotStartMinute"]),

  // One row per ISO week that has any arrive-and-drive data, purely so the
  // admin UI can populate a "filter by week" dropdown without scanning
  // raceTimeBucketsByWeek.
  raceTimeWeeks: defineTable({
    isoYear: v.number(),
    isoWeek: v.number(),
    weekStartMs: v.number(), // Monday of this ISO week, date-only (label/sort use only)
  }).index("by_year_week", ["isoYear", "isoWeek"]),

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
