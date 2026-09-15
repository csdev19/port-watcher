import { makeTodo } from "@monorepo-template/domain/testing";
import { describe, expect, it } from "vitest";
import { mockTodoRepo } from "../../__tests__/mocks/repos";
import { createTodo } from "../create-todo";

describe("createTodo", () => {
  it("attaches the userId and delegates to the repository", async () => {
    const repo = mockTodoRepo();
    const created = makeTodo({ title: "Buy milk", userId: "user-42" });
    repo.create.mockResolvedValue(created);

    const result = await createTodo(repo, { title: "Buy milk", categoryId: null }, "user-42");

    expect(repo.create).toHaveBeenCalledWith({
      title: "Buy milk",
      categoryId: null,
      userId: "user-42",
    });
    expect(result).toBe(created);
  });

  it("passes the use case's userId, not one from the payload", async () => {
    const repo = mockTodoRepo();
    repo.create.mockImplementation(async (data) => makeTodo(data));

    await createTodo(repo, { title: "Scoped" }, "owner-1");

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ userId: "owner-1" }));
  });
});
