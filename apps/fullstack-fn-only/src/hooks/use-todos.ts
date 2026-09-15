import {
  useMutation,
  useQuery,
  useQueryClient,
  queryOptions,
  keepPreviousData,
} from "@tanstack/react-query";
import { listTodos } from "@/server-functions/list-todos";
import { createTodo } from "@/server-functions/create-todo";
import { updateTodo as updateTodoFn } from "@/server-functions/update-todo";
import { deleteTodo as deleteTodoFn } from "@/server-functions/delete-todo";
import { getTodo } from "@/server-functions/get-todo";

interface TodosParams {
  page: number;
  limit: number;
}

export const todoKeys = {
  all: ["todos"] as const,
  list: (params?: TodosParams) => [...todoKeys.all, "list", params] as const,
  detail: (id: string) => [...todoKeys.all, "detail", id] as const,
};

export const todosQueryOptions = (params: TodosParams) =>
  queryOptions({
    queryKey: todoKeys.list(params),
    queryFn: () => listTodos({ data: { page: params.page, limit: params.limit } }),
    placeholderData: keepPreviousData,
  });

export const useTodos = (params: TodosParams) => {
  return useQuery(todosQueryOptions(params));
};

export const useTodo = (id: string) => {
  return useQuery({
    queryKey: todoKeys.detail(id),
    queryFn: async () => {
      const result = await getTodo({ data: { id } });
      if (result.error) throw new Error(result.error.message);
      return result;
    },
    enabled: !!id,
  });
};

export const useCreateTodo = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (title: string) => {
      const result = await createTodo({ data: { title } });
      if (result.error) throw new Error(result.error.message);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: todoKeys.all });
    },
  });
};

export const useUpdateTodo = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string; title?: string; completed?: boolean }) => {
      const result = await updateTodoFn({ data: { id, data } });
      if (result.error) throw new Error(result.error.message);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: todoKeys.all });
    },
  });
};

export const useDeleteTodo = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const result = await deleteTodoFn({ data: { id } });
      if (result.error) throw new Error(result.error.message);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: todoKeys.all });
    },
  });
};
