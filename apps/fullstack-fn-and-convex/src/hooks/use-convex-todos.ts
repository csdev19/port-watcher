import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { useMutation } from "convex/react";
import { api } from "@monorepo-template/convex-api/convex/_generated/api";

export const useConvexTodos = () => {
  return useQuery(convexQuery(api.todos.list, {}));
};

export const useCreateConvexTodo = () => {
  return useMutation(api.todos.create);
};

export const useUpdateConvexTodo = () => {
  return useMutation(api.todos.update);
};

export const useDeleteConvexTodo = () => {
  return useMutation(api.todos.remove);
};
