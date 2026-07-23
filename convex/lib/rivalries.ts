import type { Id } from "../_generated/dataModel";

type RivalryEntry = { driverId?: Id<"drivers">; position: number };

/** Upserts the (driverId, opponentId) row in driverRivalries by the given deltas. */
export async function applyRivalryDelta(
  ctx: { db: any },
  driverId: Id<"drivers">,
  opponentId: Id<"drivers">,
  dRaces: number,
  dWins: number,
  dLosses: number,
) {
  const existing = await ctx.db
    .query("driverRivalries")
    .withIndex("by_driver_opponent", (q: any) => q.eq("driverId", driverId).eq("opponentId", opponentId))
    .unique();

  if (existing) {
    await ctx.db.patch(existing._id, {
      races: existing.races + dRaces,
      wins: existing.wins + dWins,
      losses: existing.losses + dLosses,
    });
  } else {
    await ctx.db.insert("driverRivalries", {
      driverId,
      opponentId,
      races: dRaces,
      wins: dWins,
      losses: dLosses,
    });
  }
}

/** Applies every ordered pairwise delta (sign) among a heat's entries to driverRivalries. */
async function applyHeatPairwiseDeltas(ctx: { db: any }, entries: RivalryEntry[], sign: 1 | -1) {
  for (const a of entries) {
    if (!a.driverId) continue;
    for (const b of entries) {
      if (!b.driverId || b.driverId === a.driverId) continue;
      const win = a.position < b.position ? 1 : 0;
      const loss = a.position > b.position ? 1 : 0;
      await applyRivalryDelta(ctx, a.driverId, b.driverId, sign * 1, sign * win, sign * loss);
    }
  }
}

/**
 * Incrementally keeps driverRivalries in sync with one heat's write: undoes
 * the old entries' pairwise contribution (if any, e.g. a rescrape) and adds
 * the new entries' contribution. Cost is O(heat size squared), not
 * O(driver's total heat count), so it stays cheap regardless of how many
 * heats a driver has ever raced.
 */
export async function updateRivalriesForHeat(
  ctx: { db: any },
  oldEntries: RivalryEntry[],
  newEntries: RivalryEntry[],
) {
  await applyHeatPairwiseDeltas(ctx, oldEntries, -1);
  await applyHeatPairwiseDeltas(ctx, newEntries, 1);
}

/**
 * Folds sourceDriverId's rivalry history into targetDriverId's, for use
 * during driver merges. Bounded by source's distinct rival count (small
 * rows, no `laps`), not source's total heat count, so it stays cheap even
 * for a merge candidate with a long racing history.
 */
export async function mergeRivalries(
  ctx: { db: any },
  sourceDriverId: Id<"drivers">,
  targetDriverId: Id<"drivers">,
) {
  const sourceRows = await ctx.db
    .query("driverRivalries")
    .withIndex("by_driver_opponent", (q: any) => q.eq("driverId", sourceDriverId))
    .collect();

  for (const row of sourceRows) {
    const oppId = row.opponentId as Id<"drivers">;
    if (oppId !== targetDriverId) {
      await applyRivalryDelta(ctx, targetDriverId, oppId, row.races, row.wins, row.losses);
    }
    await ctx.db.delete(row._id);

    const mirror = await ctx.db
      .query("driverRivalries")
      .withIndex("by_driver_opponent", (q: any) => q.eq("driverId", oppId).eq("opponentId", sourceDriverId))
      .unique();
    if (mirror) {
      if (oppId !== targetDriverId) {
        await applyRivalryDelta(ctx, oppId, targetDriverId, mirror.races, mirror.wins, mirror.losses);
      }
      await ctx.db.delete(mirror._id);
    }
  }
}
