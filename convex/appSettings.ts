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
