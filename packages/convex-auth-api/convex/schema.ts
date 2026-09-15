import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Public demo table (categories.list has no auth check).
  categories: defineTable({
    name: v.string(),
    type: v.union(v.literal("general"), v.literal("user-personal")),
  }).index("by_type", ["type"]),
  // Per-user demo table (todos.* require a Better Auth session).
  todos: defineTable({
    title: v.string(),
    completed: v.boolean(),
    subject: v.string(),
  }).index("by_subject", ["subject"]),
});
