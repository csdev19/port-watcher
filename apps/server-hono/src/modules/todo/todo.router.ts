import { implement, ORPCError } from "@orpc/server";
import { todoContract } from "../../contract/todo.contract";
import { createDatabaseClient } from "@monorepo-template/infra-db/client";
import { TodoRepository } from "@monorepo-template/infra-db/repositories";
import { listTodos } from "@monorepo-template/application";
import { authMiddleware } from "../../middleware/auth";
import { env } from "../../env";

const db = createDatabaseClient(env.DATABASE_URL);
const repo = new TodoRepository(db);

const impl = implement(todoContract).$context<{ headers: Headers }>();

export const todoRouter = impl.router({
  list: impl.list.use(authMiddleware).handler(async ({ input, context }) => {
    const result = await listTodos({
      repo,
      userId: context.user.id,
      pagination: input,
    });

    if (result.error) throw result.error;

    return {
      data: result.data.data,
      error: null,
      meta: { pagination: result.data.meta },
    };
  }),

  get: impl.get.use(authMiddleware).handler(async ({ input, context }) => {
    const todo = await repo.findById(input.id, context.user.id);

    if (!todo) {
      throw new ORPCError("NOT_FOUND", { message: "Todo not found" });
    }

    return { data: todo, error: null };
  }),

  create: impl.create.use(authMiddleware).handler(async ({ input, context }) => {
    const todo = await repo.create({
      title: input.title,
      userId: context.user.id,
    });

    return { data: todo, error: null };
  }),

  update: impl.update.use(authMiddleware).handler(async ({ input, context }) => {
    const { id, ...data } = input;
    const todo = await repo.update(id, context.user.id, data);

    if (!todo) {
      throw new ORPCError("NOT_FOUND", { message: "Todo not found" });
    }

    return { data: todo, error: null };
  }),

  delete: impl.delete.use(authMiddleware).handler(async ({ input, context }) => {
    const deleted = await repo.delete(input.id, context.user.id);

    if (!deleted) {
      throw new ORPCError("NOT_FOUND", { message: "Todo not found" });
    }

    return { data: { success: true }, error: null };
  }),
});
