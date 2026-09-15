import type { TodoBase } from "@monorepo-template/domain/schemas";
import type { todoTable } from "../schema/todo";

type TodoRow = typeof todoTable.$inferSelect;

export function mapTodoToDomain(row: TodoRow): TodoBase {
  return {
    id: row.id,
    title: row.title,
    completed: row.completed,
    categoryId: row.categoryId ?? null,
    userId: row.userId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
