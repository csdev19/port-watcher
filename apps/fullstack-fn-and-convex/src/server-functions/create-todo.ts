import { createServerFn } from "@tanstack/react-start";
import type { ApiResponse } from "@monorepo-template/domain/types";
import type { TodoBase } from "@monorepo-template/domain/schemas";
import { createTodoSchema } from "@monorepo-template/domain/schemas";
import { createDatabaseClient } from "@monorepo-template/infra-db/client";
import { TodoRepository } from "@monorepo-template/infra-db/repositories";
import { getAuthSession } from "@/lib/auth/get-auth-session";
import { env } from "@/env/server";

export const createTodo = createServerFn({ method: "POST" })
  .inputValidator((input: { title: string; categoryId?: string | null }) =>
    createTodoSchema.parse(input),
  )
  .handler(async (ctx): Promise<ApiResponse<TodoBase>> => {
    const session = await getAuthSession();

    if (!session) {
      return { data: null, error: { message: "Unauthorized" } };
    }

    const db = createDatabaseClient(env.DATABASE_URL);
    const repo = new TodoRepository(db);
    const todo = await repo.create({
      title: ctx.data.title,
      categoryId: ctx.data.categoryId ?? null,
      userId: session.user.id,
    });

    return { data: todo, error: null };
  });
