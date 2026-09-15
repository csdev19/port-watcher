import { describe, expect, it } from "vitest";
import { makeTodo } from "../../testing";
import { createTodoSchema, todoBaseSchema, updateTodoSchema } from "../todo";

describe("todo schemas", () => {
  it("accepts a well-formed todo", () => {
    expect(todoBaseSchema.safeParse(makeTodo()).success).toBe(true);
  });

  it("rejects an empty title with a helpful message", () => {
    const parsed = createTodoSchema.safeParse({ title: "" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe("Title is required");
    }
  });

  it("rejects a title longer than 500 characters", () => {
    expect(createTodoSchema.safeParse({ title: "x".repeat(501) }).success).toBe(false);
  });

  it("allows an explicit null categoryId on create", () => {
    expect(createTodoSchema.safeParse({ title: "ok", categoryId: null }).success).toBe(true);
  });

  it("allows a partial update (every field optional)", () => {
    expect(updateTodoSchema.safeParse({ completed: true }).success).toBe(true);
    expect(updateTodoSchema.safeParse({}).success).toBe(true);
  });
});
