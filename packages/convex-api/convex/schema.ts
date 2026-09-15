import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  categories: defineTable({
    name: v.string(),
    type: v.union(v.literal("general"), v.literal("user-personal")),
  }).index("by_type", ["type"]),
  todos: defineTable({
    title: v.string(),
    completed: v.boolean(),
    subject: v.string(),
  }).index("by_subject", ["subject"]),
});
