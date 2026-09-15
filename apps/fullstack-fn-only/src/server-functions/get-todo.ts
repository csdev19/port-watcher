import { createServerFn } from "@tanstack/react-start";
import type { ApiResponse } from "@monorepo-template/domain/types";
import type { TodoBase } from "@monorepo-template/domain/schemas";
import { createDatabaseClient } from "@monorepo-template/infra-db/client";
import { TodoRepository } from "@monorepo-template/infra-db/repositories";
import { getAuthSession } from "@/lib/auth/get-auth-session";
import { env } from "@/env/server";
import z from "zod";

const getTodoInputSchema = z.object({
  id: z.string(),
});

export const getTodo = createServerFn({ method: "GET" })
  .inputValidator((input: { id: string }) => getTodoInputSchema.parse(input))
  .handler(async (ctx): Promise<ApiResponse<TodoBase>> => {
    const session = await getAuthSession();

    if (!session) {
      return { data: null, error: { message: "Unauthorized" } };
    }

    const db = createDatabaseClient(env.DATABASE_URL);
    const repo = new TodoRepository(db);
    const todo = await repo.findById(ctx.data.id, session.user.id);

    if (!todo) {
      return { data: null, error: { message: "Todo not found" } };
    }

    return { data: todo, error: null };
  });
