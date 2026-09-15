import {
  useMutation,
  useQuery,
  useQueryClient,
  queryOptions,
  keepPreviousData,
} from "@tanstack/react-query";
import { clientTreaty } from "@/lib/client-treaty";

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
    queryFn: async () => {
      const { data, error } = await clientTreaty.api.v1.todos.get({
        query: { page: params.page, limit: params.limit },
      });
      if (error) throw new Error("Failed to fetch todos");
      return data;
    },
    placeholderData: keepPreviousData,
  });

export const useTodos = (params: TodosParams) => {
  return useQuery(todosQueryOptions(params));
};

export const useTodo = (id: string) => {
  return useQuery({
    queryKey: todoKeys.detail(id),
    queryFn: async () => {
      const { data, error } = await clientTreaty.api.v1.todos({ id }).get();
      if (error) throw new Error("Failed to fetch todo");
      return data;
    },
    enabled: !!id,
  });
};

export const useCreateTodo = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (title: string) => {
      const { data, error } = await clientTreaty.api.v1.todos.post({ title });
      if (error) throw new Error("Failed to create todo");
      return data;
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
      const { data: result, error } = await clientTreaty.api.v1.todos({ id }).put(data);
      if (error) throw new Error("Failed to update todo");
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
      const { data, error } = await clientTreaty.api.v1.todos({ id }).delete();
      if (error) throw new Error("Failed to delete todo");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: todoKeys.all });
    },
  });
};
