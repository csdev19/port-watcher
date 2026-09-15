import { eq, and, count, desc } from "drizzle-orm";
import type { ITodoRepository } from "@monorepo-template/domain/repositories";
import type { CreateTodo, UpdateTodo, TodoBase } from "@monorepo-template/domain/schemas";
import { todoTable } from "../schema";
import { mapTodoToDomain } from "../mappers/todo.mapper";
import type { DatabaseClient } from "../client";

export class TodoRepository implements ITodoRepository {
  constructor(private db: DatabaseClient) {}

  async findById(id: string, userId: string): Promise<TodoBase | null> {
    const results = await this.db
      .select()
      .from(todoTable)
      .where(and(eq(todoTable.id, id), eq(todoTable.userId, userId)))
      .limit(1);

    return results[0] ? mapTodoToDomain(results[0]) : null;
  }

  async findAllByUserId(userId: string): Promise<TodoBase[]> {
    const results = await this.db
      .select()
      .from(todoTable)
      .where(eq(todoTable.userId, userId))
      .orderBy(desc(todoTable.updatedAt));

    return results.map(mapTodoToDomain);
  }

  async findAllByUserIdPaginated(
    userId: string,
    limit: number,
    offset: number,
  ): Promise<{ data: TodoBase[]; total: number }> {
    const [results, totalResult] = await Promise.all([
      this.db
        .select()
        .from(todoTable)
        .where(eq(todoTable.userId, userId))
        .orderBy(desc(todoTable.updatedAt))
        .limit(limit)
        .offset(offset),
      this.db.select({ count: count() }).from(todoTable).where(eq(todoTable.userId, userId)),
    ]);

    return {
      data: results.map(mapTodoToDomain),
      total: totalResult[0]?.count ?? 0,
    };
  }

  async create(data: CreateTodo & { userId: string }): Promise<TodoBase> {
    const results = await this.db
      .insert(todoTable)
      .values({
        title: data.title,
        categoryId: data.categoryId ?? null,
        userId: data.userId,
      })
      .returning();

    return mapTodoToDomain(results[0]!);
  }

  async update(id: string, userId: string, data: UpdateTodo): Promise<TodoBase | null> {
    const results = await this.db
      .update(todoTable)
      .set(data)
      .where(and(eq(todoTable.id, id), eq(todoTable.userId, userId)))
      .returning();

    return results[0] ? mapTodoToDomain(results[0]) : null;
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const results = await this.db
      .delete(todoTable)
      .where(and(eq(todoTable.id, id), eq(todoTable.userId, userId)))
      .returning();

    return results.length > 0;
  }
}
