import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Button,
  Card,
  CardContent,
  Input,
  Checkbox,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Skeleton,
} from "@monorepo-template/web-ui";
import { Plus, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import {
  useTodos,
  todosQueryOptions,
  useCreateTodo,
  useUpdateTodo,
  useDeleteTodo,
} from "@/hooks/use-todos";

const DEFAULT_PAGE_SIZE = 5;

export const Route = createFileRoute("/_authenticated/todos/")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(todosQueryOptions({ page: 1, limit: DEFAULT_PAGE_SIZE })),
  component: TodosPage,
});

function TodosPage() {
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: DEFAULT_PAGE_SIZE });
  const page = pagination.pageIndex + 1;

  const {
    data: todosResponse,
    isPending,
    isPlaceholderData,
    error,
  } = useTodos({
    page,
    limit: pagination.pageSize,
  });
  const createTodo = useCreateTodo();
  const updateTodo = useUpdateTodo();
  const deleteTodo = useDeleteTodo();
  const [newTitle, setNewTitle] = useState("");

  const todos = todosResponse?.data ?? [];
  const paginationMeta = todosResponse?.meta?.pagination;
  const totalPages = paginationMeta?.totalPages ?? 1;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    createTodo.mutate(newTitle.trim(), {
      onSuccess: () => {
        setNewTitle("");
        toast.success("Todo created");
      },
      onError: () => {
        toast.error("Failed to create todo");
      },
    });
  };

  const handleToggle = (id: string, completed: boolean) => {
    updateTodo.mutate(
      { id, completed: !completed },
      {
        onError: () => {
          toast.error("Failed to update todo");
        },
      },
    );
  };

  const handleDelete = (id: string) => {
    deleteTodo.mutate(id, {
      onSuccess: () => {
        toast.success("Todo deleted");
      },
      onError: () => {
        toast.error("Failed to delete todo");
      },
    });
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">Todos</h1>
      </div>

      <Card className="mb-8">
        <CardContent className="p-4">
          <form onSubmit={handleCreate} className="flex gap-3">
            <Input
              placeholder="What needs to be done?"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="flex-1"
            />
            <Button type="submit" disabled={createTodo.isPending || !newTitle.trim()}>
              <Plus className="h-4 w-4 mr-2" />
              Add
            </Button>
          </form>
        </CardContent>
      </Card>

      {isPending ? (
        <Card>
          <CardContent className="p-4 space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={`skeleton-${i}`} className="flex items-center gap-3">
                <Skeleton className="h-5 w-5 rounded" />
                <Skeleton className="h-5 flex-1" />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : error ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-destructive">Failed to load todos</p>
          </CardContent>
        </Card>
      ) : todos.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">No todos yet. Create one above!</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12" />
                <TableHead>Title</TableHead>
                <TableHead className="w-20 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {todos.map((todo) => (
                <TableRow key={todo.id}>
                  <TableCell>
                    <Checkbox
                      checked={todo.completed}
                      onCheckedChange={() => handleToggle(todo.id, todo.completed)}
                    />
                  </TableCell>
                  <TableCell>
                    <span className={todo.completed ? "line-through text-muted-foreground" : ""}>
                      {todo.title}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(todo.id)}
                      disabled={deleteTodo.isPending}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-muted-foreground">
            Page {page} of {totalPages} ({paginationMeta?.total ?? 0} total)
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPagination((prev) => ({ ...prev, pageIndex: prev.pageIndex - 1 }))}
              disabled={pagination.pageIndex === 0}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPagination((prev) => ({ ...prev, pageIndex: prev.pageIndex + 1 }))}
              disabled={page >= totalPages || isPlaceholderData}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
