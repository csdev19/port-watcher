import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/** Auth-gated query — only the signed-in user's todos (Better Auth identity). */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    return await ctx.db
      .query("todos")
      .withIndex("by_subject", (q) => q.eq("subject", identity.subject))
      .collect();
  },
});

export const create = mutation({
  args: { title: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    return await ctx.db.insert("todos", {
      title: args.title,
      completed: false,
      subject: identity.subject,
    });
  },
});
