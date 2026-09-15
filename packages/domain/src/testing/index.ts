import type { TodoBase } from "../schemas/todo";

/**
 * Test fixtures for the domain layer, exposed as `@monorepo-template/domain/testing`.
 *
 * Builders take a `Partial<T>` of overrides and fill the rest with deterministic
 * defaults, so a test states only the fields it cares about.
 */

let seq = 0;

/** Build a `TodoBase`. Override any field via `overrides`. */
export function makeTodo(overrides: Partial<TodoBase> = {}): TodoBase {
  seq += 1;
  const at = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: `todo-${seq}`,
    title: `Todo ${seq}`,
    completed: false,
    categoryId: null,
    userId: "user-1",
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}
