import type { TodoBase, CreateTodo, UpdateTodo } from "../schemas/todo";

export interface ITodoRepository {
  findById(id: string, userId: string): Promise<TodoBase | null>;
  findAllByUserId(userId: string): Promise<TodoBase[]>;
  findAllByUserIdPaginated(
    userId: string,
    limit: number,
    offset: number,
  ): Promise<{ data: TodoBase[]; total: number }>;
  create(data: CreateTodo & { userId: string }): Promise<TodoBase>;
  update(id: string, userId: string, data: UpdateTodo): Promise<TodoBase | null>;
  delete(id: string, userId: string): Promise<boolean>;
}
