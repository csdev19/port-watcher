import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import type { ITodoRepository } from "@monorepo-template/domain/repositories";
import type { CreateTodo, TodoBase, UpdateTodo } from "@monorepo-template/domain/schemas";

/** A row exactly as SQLite returns it — snake_case, numbers for bools and dates. */
interface TodoRow {
  id: string;
  title: string;
  completed: number;
  category_id: string | null;
  user_id: string;
  created_at: number;
  updated_at: number;
}

/**
 * `node:sqlite` types every column as `SQLOutputValue`, so the shape has to be
 * asserted somewhere. Doing it in one named function keeps the cast auditable:
 * it is correct as long as this file's CREATE TABLE and its queries agree, and
 * both live in `./database.ts` next door.
 */
function asRow(raw: Record<string, SQLOutputValue>): TodoRow {
  return raw as unknown as TodoRow;
}

function toDomain(row: TodoRow): TodoBase {
  return {
    id: row.id,
    title: row.title,
    completed: row.completed === 1,
    categoryId: row.category_id,
    userId: row.user_id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * The local-first adapter for `ITodoRepository`.
 *
 * This is the point of the desktop app inside this template: the same port that
 * `packages/infra-db` implements against Drizzle/Postgres for the server is
 * implemented here against on-device SQLite. The use cases in
 * `@monorepo-template/application` are shared verbatim between the two — swapping
 * the adapter is the only difference.
 */
export class SqliteTodoRepository implements ITodoRepository {
  constructor(private readonly db: DatabaseSync) {}

  async findById(id: string, userId: string): Promise<TodoBase | null> {
    const row = this.db.prepare("SELECT * FROM todos WHERE id = ? AND user_id = ?").get(id, userId);
    return row ? toDomain(asRow(row)) : null;
  }

  async findAllByUserId(userId: string): Promise<TodoBase[]> {
    const rows = this.db
      .prepare("SELECT * FROM todos WHERE user_id = ? ORDER BY updated_at DESC")
      .all(userId);
    return rows.map((row) => toDomain(asRow(row)));
  }

  async findAllByUserIdPaginated(
    userId: string,
    limit: number,
    offset: number,
  ): Promise<{ data: TodoBase[]; total: number }> {
    const rows = this.db
      .prepare("SELECT * FROM todos WHERE user_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?")
      .all(userId, limit, offset);
    const totalRow = this.db
      .prepare("SELECT COUNT(*) AS total FROM todos WHERE user_id = ?")
      .get(userId);
    return {
      data: rows.map((row) => toDomain(asRow(row))),
      total: Number(totalRow?.total ?? 0),
    };
  }

  async create(data: CreateTodo & { userId: string }): Promise<TodoBase> {
    const now = Date.now();
    const row: TodoRow = {
      id: crypto.randomUUID(),
      title: data.title,
      completed: 0,
      category_id: data.categoryId ?? null,
      user_id: data.userId,
      created_at: now,
      updated_at: now,
    };
    this.db
      .prepare(
        `INSERT INTO todos (id, title, completed, category_id, user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.title,
        row.completed,
        row.category_id,
        row.user_id,
        row.created_at,
        row.updated_at,
      );
    return toDomain(row);
  }

  async update(id: string, userId: string, data: UpdateTodo): Promise<TodoBase | null> {
    const raw = this.db.prepare("SELECT * FROM todos WHERE id = ? AND user_id = ?").get(id, userId);
    if (!raw) return null;
    const existing = asRow(raw);

    const next: TodoRow = {
      ...existing,
      title: data.title ?? existing.title,
      completed: data.completed === undefined ? existing.completed : data.completed ? 1 : 0,
      category_id: data.categoryId === undefined ? existing.category_id : data.categoryId,
      updated_at: Date.now(),
    };
    this.db
      .prepare(
        `UPDATE todos SET title = ?, completed = ?, category_id = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
      )
      .run(next.title, next.completed, next.category_id, next.updated_at, id, userId);
    return toDomain(next);
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const result = this.db
      .prepare("DELETE FROM todos WHERE id = ? AND user_id = ?")
      .run(id, userId);
    return Number(result.changes) > 0;
  }
}
