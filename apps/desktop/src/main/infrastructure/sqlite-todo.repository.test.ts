import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTodo, listTodos, updateTodo } from "@monorepo-template/application";
import { openDatabase } from "./database";
import { SqliteTodoRepository } from "./sqlite-todo.repository";

const USER = "local-user";
const OTHER_USER = "someone-else";

describe("SqliteTodoRepository", () => {
  let db: DatabaseSync;
  let repo: SqliteTodoRepository;

  beforeEach(() => {
    db = openDatabase(join(mkdtempSync(join(tmpdir(), "desktop-db-")), "app.db"));
    repo = new SqliteTodoRepository(db);
  });

  afterEach(() => db.close());

  it("round-trips a todo through create and findById", async () => {
    const created = await repo.create({ title: "Write the ADR", categoryId: null, userId: USER });
    const found = await repo.findById(created.id, USER);

    expect(found).toEqual(created);
    expect(created.completed).toBe(false);
    expect(created.createdAt).toBeInstanceOf(Date);
  });

  it("scopes every read to the owning user", async () => {
    const created = await repo.create({ title: "Private", categoryId: null, userId: USER });

    expect(await repo.findById(created.id, OTHER_USER)).toBeNull();
    expect(await repo.findAllByUserId(OTHER_USER)).toEqual([]);
  });

  it("applies a partial update and leaves other fields alone", async () => {
    const created = await repo.create({ title: "Original", categoryId: null, userId: USER });
    const updated = await repo.update(created.id, USER, { completed: true });

    expect(updated?.completed).toBe(true);
    expect(updated?.title).toBe("Original");
  });

  it("returns null when updating a todo the user does not own", async () => {
    const created = await repo.create({ title: "Theirs", categoryId: null, userId: USER });

    expect(await repo.update(created.id, OTHER_USER, { title: "Hijacked" })).toBeNull();
  });

  it("reports whether a delete removed anything", async () => {
    const created = await repo.create({ title: "Temporary", categoryId: null, userId: USER });

    expect(await repo.delete(created.id, OTHER_USER)).toBe(false);
    expect(await repo.delete(created.id, USER)).toBe(true);
    expect(await repo.delete(created.id, USER)).toBe(false);
  });

  it("paginates and reports the unpaginated total", async () => {
    for (const title of ["a", "b", "c"]) {
      await repo.create({ title, categoryId: null, userId: USER });
    }

    const page = await repo.findAllByUserIdPaginated(USER, 2, 0);

    expect(page.data).toHaveLength(2);
    expect(page.total).toBe(3);
  });

  it("survives a reopen — the data is on disk, not in memory", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "desktop-db-")), "app.db");
    const first = openDatabase(path);
    await new SqliteTodoRepository(first).create({
      title: "Persisted",
      categoryId: null,
      userId: USER,
    });
    first.close();

    const second = openDatabase(path);
    const todos = await new SqliteTodoRepository(second).findAllByUserId(USER);
    second.close();

    expect(todos.map((todo) => todo.title)).toEqual(["Persisted"]);
  });

  /**
   * The reason this app exists inside the template: the use cases in
   * `@monorepo-template/application` are written against the port, so they run
   * unchanged on this local adapter and on the server's Drizzle one.
   */
  it("runs the shared use cases against the local adapter", async () => {
    await createTodo(repo, { title: "From a use case" }, USER);
    const created = (await repo.findAllByUserId(USER))[0]!;
    await updateTodo(repo, created.id, USER, { completed: true });

    const result = await listTodos({ repo, userId: USER, pagination: { page: 1, limit: 10 } });

    expect(result.error).toBeNull();
    expect(result.data?.data).toHaveLength(1);
    expect(result.data?.data[0]?.completed).toBe(true);
    expect(result.data?.meta.total).toBe(1);
  });
});
