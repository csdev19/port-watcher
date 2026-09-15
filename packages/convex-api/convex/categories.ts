import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

const categoryValidator = v.object({
  _id: v.id("categories"),
  _creationTime: v.number(),
  name: v.string(),
  type: v.union(v.literal("general"), v.literal("user-personal")),
});

export const list = query({
  args: {
    type: v.optional(v.union(v.literal("general"), v.literal("user-personal"))),
  },
  returns: v.array(categoryValidator),
  handler: async (ctx, args) => {
    if (args.type) {
      return await ctx.db
        .query("categories")
        .withIndex("by_type", (q) => q.eq("type", args.type!))
        .collect();
    }
    return await ctx.db.query("categories").collect();
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    type: v.union(v.literal("general"), v.literal("user-personal")),
  },
  returns: v.id("categories"),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    console.log("Identity in create category:", identity);
    if (!identity) {
      throw new Error("Not authenticated");
    }
    return await ctx.db.insert("categories", {
      name: args.name,
      type: args.type,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("categories"),
    name: v.optional(v.string()),
    type: v.optional(v.union(v.literal("general"), v.literal("user-personal"))),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }
    const { id, ...updates } = args;
    const cleanUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, val]) => val !== undefined),
    );

    if (Object.keys(cleanUpdates).length > 0) {
      await ctx.db.patch(id, cleanUpdates);
    }
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("categories") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }
    await ctx.db.delete(args.id);
    return null;
  },
});
