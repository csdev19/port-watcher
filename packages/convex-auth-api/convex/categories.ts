import { query } from "./_generated/server";
import { v } from "convex/values";

/** Public query — no auth. Proves the Convex data round-trip. */
export const list = query({
  args: {
    type: v.optional(v.union(v.literal("general"), v.literal("user-personal"))),
  },
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
