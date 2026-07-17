import { v } from "convex/values";
import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { requireAdmin } from "./lib/adminAuth";

export const get = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const row = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    return row?.value ?? null;
  },
});

export const getInternal = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const row = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    return row?.value ?? null;
  },
});

export const set = mutation({
  args: { key: v.string(), value: v.any(), adminSecret: v.string() },
  handler: async (ctx, { key, value, adminSecret }) => {
    requireAdmin(adminSecret);
    const row = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (row) {
      await ctx.db.patch(row._id, { value });
    } else {
      await ctx.db.insert("appSettings", { key, value });
    }
  },
});

export const setInternal = internalMutation({
  args: { key: v.string(), value: v.any() },
  handler: async (ctx, { key, value }) => {
    const row = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (row) {
      await ctx.db.patch(row._id, { value });
    } else {
      await ctx.db.insert("appSettings", { key, value });
    }
  },
});

export const stats = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("appStats").first();
  },
});

export const statsInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("appStats").first();
  },
});

/** Side-effect-free check so the UI can confirm a secret is correct the moment it's entered, rather than only failing later on some other admin action. */
export const verifyAdminSecret = mutation({
  args: { adminSecret: v.string() },
  handler: async (_ctx, { adminSecret }) => {
    requireAdmin(adminSecret);
    return true;
  },
});

/**
 * Owner-token + heartbeat lock so a self-rescheduling chain (see
 * scrapeHeats.ts) can't accidentally run twice in parallel - e.g. if a
 * redeploy re-triggers a cron's "run shortly after deploy" behavior while a
 * chain from a previous deploy is still alive. A "fresh start" caller (no
 * token yet) only wins the claim if the existing owner's heartbeat is
 * stale (i.e. actually dead), so a live chain can't be duplicated, but a
 * genuinely dead one still gets revived.
 */
export const claimChainIfIdle = internalMutation({
  args: { key: v.string(), newToken: v.string(), staleAfterMs: v.number() },
  handler: async (ctx, { key, newToken, staleAfterMs }) => {
    const row = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    const current = row?.value as { token: string; lastHeartbeat: number } | undefined;
    const now = Date.now();
    if (current && now - current.lastHeartbeat < staleAfterMs) {
      return null; // a live owner already holds this chain
    }
    const value = { token: newToken, lastHeartbeat: now };
    if (row) await ctx.db.patch(row._id, { value });
    else await ctx.db.insert("appSettings", { key, value });
    return newToken;
  },
});

/** Called by a continuing chain link to prove it's still the legitimate owner and refresh its heartbeat. */
export const heartbeatIfOwner = internalMutation({
  args: { key: v.string(), token: v.string() },
  handler: async (ctx, { key, token }) => {
    const row = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    const current = row?.value as { token: string; lastHeartbeat: number } | undefined;
    if (!current || current.token !== token) return false;
    await ctx.db.patch(row!._id, { value: { token, lastHeartbeat: Date.now() } });
    return true;
  },
});
