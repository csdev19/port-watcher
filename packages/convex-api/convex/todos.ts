import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

const todoValidator = v.object({
  _id: v.id("todos"),
  _creationTime: v.number(),
  title: v.string(),
  completed: v.boolean(),
  subject: v.string(),
});

export const list = query({
  args: {},
  returns: v.array(todoValidator),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }
    return await ctx.db
      .query("todos")
      .withIndex("by_subject", (q) => q.eq("subject", identity.subject))
      .collect();
  },
});

export const create = mutation({
  args: {
    title: v.string(),
  },
  returns: v.id("todos"),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }
    return await ctx.db.insert("todos", {
      title: args.title,
      completed: false,
      subject: identity.subject,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("todos"),
    title: v.optional(v.string()),
    completed: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }
    const todo = await ctx.db.get(args.id);
    if (!todo || todo.subject !== identity.subject) {
      throw new Error("Todo not found");
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
  args: { id: v.id("todos") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }
    const todo = await ctx.db.get(args.id);
    if (!todo || todo.subject !== identity.subject) {
      throw new Error("Todo not found");
    }
    await ctx.db.delete(args.id);
    return null;
  },
});
