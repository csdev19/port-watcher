import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@monorepo-template/web-ui";
import { Plus, Trash2, ChevronLeft, ChevronRight, Tag, Pencil } from "lucide-react";
import { useState } from "react";
import {
  useTodos,
  todosQueryOptions,
  useCreateTodo,
  useUpdateTodo,
  useDeleteTodo,
} from "@/hooks/use-todos";
import { useCategories, useCreateCategory, useDeleteCategory } from "@/hooks/use-categories";
import {
  useConvexTodos,
  useCreateConvexTodo,
  useUpdateConvexTodo,
  useDeleteConvexTodo,
} from "@/hooks/use-convex-todos";

const DEFAULT_PAGE_SIZE = 5;
const NO_CATEGORY = "__none__";

export const Route = createFileRoute("/_authenticated/todos/")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(todosQueryOptions({ page: 1, limit: DEFAULT_PAGE_SIZE })),
  component: TodosPage,
});

function TodosPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">Todos</h1>
      </div>

      <CategoriesSection />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PostgresTodosColumn />
        <ConvexTodosColumn />
      </div>
    </div>
  );
}

function PostgresTodosColumn() {
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
  const { data: categories } = useCategories();
  const createTodo = useCreateTodo();
  const updateTodo = useUpdateTodo();
  const deleteTodo = useDeleteTodo();

  const [newTitle, setNewTitle] = useState("");
  const [newCategoryId, setNewCategoryId] = useState<string>(NO_CATEGORY);
  const [editingTodo, setEditingTodo] = useState<{
    id: string;
    title: string;
    categoryId: string | null;
  } | null>(null);

  const todos = todosResponse?.data ?? [];
  const paginationMeta = todosResponse?.meta?.pagination;
  const totalPages = paginationMeta?.totalPages ?? 1;

  const getCategoryName = (categoryId: string | null) => {
    if (!categoryId || !categories) return null;
    return categories.find((c) => c._id === categoryId)?.name ?? null;
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    createTodo.mutate(
      {
        title: newTitle.trim(),
        categoryId: newCategoryId === NO_CATEGORY ? null : newCategoryId,
      },
      {
        onSuccess: () => {
          setNewTitle("");
          setNewCategoryId(NO_CATEGORY);
          toast.success("Todo created");
        },
        onError: () => {
          toast.error("Failed to create todo");
        },
      },
    );
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

  const handleEditSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTodo || !editingTodo.title.trim()) return;

    updateTodo.mutate(
      {
        id: editingTodo.id,
        title: editingTodo.title.trim(),
        categoryId: editingTodo.categoryId,
      },
      {
        onSuccess: () => {
          setEditingTodo(null);
          toast.success("Todo updated");
        },
        onError: () => {
          toast.error("Failed to update todo");
        },
      },
    );
  };

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">PostgreSQL Todos</h2>

      <Card className="mb-4">
        <CardContent className="p-4">
          <form onSubmit={handleCreate} className="flex gap-3 items-end">
            <div className="flex-1">
              <Input
                placeholder="What needs to be done?"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
            </div>
            {categories && categories.length > 0 && (
              <CategorySelect
                categories={categories}
                value={newCategoryId}
                onValueChange={(val) => setNewCategoryId(val)}
                className="w-[140px]"
              />
            )}
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
                <TableHead className="w-28">Category</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {todos.map((todo) => {
                const catName = getCategoryName(todo.categoryId);
                return (
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
                    <TableCell>
                      {catName && (
                        <Badge variant="outline" className="text-xs">
                          {catName}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setEditingTodo({
                              id: todo.id,
                              title: todo.title,
                              categoryId: todo.categoryId,
                            })
                          }
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(todo.id)}
                          disabled={deleteTodo.isPending}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
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

      {/* Edit Todo Dialog */}
      <Dialog
        open={!!editingTodo}
        onOpenChange={(open) => {
          if (!open) setEditingTodo(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Todo</DialogTitle>
            <DialogDescription>Update the title and category.</DialogDescription>
          </DialogHeader>
          {editingTodo && (
            <form onSubmit={handleEditSave} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-title">Title</Label>
                <Input
                  id="edit-title"
                  value={editingTodo.title}
                  onChange={(e) =>
                    setEditingTodo((prev) => (prev ? { ...prev, title: e.target.value } : null))
                  }
                  autoFocus
                />
              </div>
              <div className="grid gap-2">
                <Label>Category</Label>
                <CategorySelect
                  categories={categories ?? []}
                  value={editingTodo.categoryId ?? NO_CATEGORY}
                  onValueChange={(val) =>
                    setEditingTodo((prev) =>
                      prev ? { ...prev, categoryId: val === NO_CATEGORY ? null : val } : null,
                    )
                  }
                  className="w-full"
                />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={updateTodo.isPending || !editingTodo.title.trim()}>
                  Save
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ConvexTodosColumn() {
  const { data: todos, isPending, error } = useConvexTodos();
  const createTodo = useCreateConvexTodo();
  const updateTodo = useUpdateConvexTodo();
  const deleteTodo = useDeleteConvexTodo();

  const [newTitle, setNewTitle] = useState("");

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    try {
      await createTodo({ title: newTitle.trim() });
      setNewTitle("");
      toast.success("Convex todo created");
    } catch {
      toast.error("Failed to create convex todo");
    }
  };

  const handleToggle = async (id: string, completed: boolean) => {
    try {
      await updateTodo({ id: id as any, completed: !completed });
    } catch {
      toast.error("Failed to update convex todo");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteTodo({ id: id as any });
      toast.success("Convex todo deleted");
    } catch {
      toast.error("Failed to delete convex todo");
    }
  };

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Convex Todos (Real-time)</h2>

      <Card className="mb-4">
        <CardContent className="p-4">
          <form onSubmit={handleCreate} className="flex gap-3 items-end">
            <div className="flex-1">
              <Input
                placeholder="Add a real-time todo..."
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={!newTitle.trim()}>
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
            <p className="text-destructive">Failed to load convex todos</p>
          </CardContent>
        </Card>
      ) : !todos || todos.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">No convex todos yet. Create one above!</p>
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
                <TableRow key={todo._id}>
                  <TableCell>
                    <Checkbox
                      checked={todo.completed}
                      onCheckedChange={() => handleToggle(todo._id, todo.completed)}
                    />
                  </TableCell>
                  <TableCell>
                    <span className={todo.completed ? "line-through text-muted-foreground" : ""}>
                      {todo.title}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(todo._id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function CategoriesSection() {
  const { data: categories, isPending } = useCategories();
  const createCategory = useCreateCategory();
  const deleteCategory = useDeleteCategory();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<"general" | "user-personal">("general");

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    try {
      await createCategory({ name: name.trim(), type });
      setName("");
      setType("general");
      setOpen(false);
      toast.success("Category created");
    } catch {
      toast.error("Failed to create category");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteCategory({ id: id as any });
      toast.success("Category deleted");
    } catch {
      toast.error("Failed to delete category");
    }
  };

  return (
    <Card className="mb-6">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Categories</span>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button variant="outline" size="sm" />}>
              <Plus className="h-4 w-4 mr-1" />
              Add Category
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New Category</DialogTitle>
                <DialogDescription>Create a new category to organize your todos.</DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreate} className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="category-name">Name</Label>
                  <Input
                    id="category-name"
                    placeholder="e.g. Work, Personal, Shopping"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Type</Label>
                  <Select
                    value={type}
                    onValueChange={(val) => setType(val as "general" | "user-personal")}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="general">General</SelectItem>
                      <SelectItem value="user-personal">Personal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={!name.trim()}>
                    Create
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {isPending ? (
          <div className="flex gap-2">
            <Skeleton className="h-6 w-16 rounded-full" />
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-6 w-14 rounded-full" />
          </div>
        ) : !categories || categories.length === 0 ? (
          <p className="text-sm text-muted-foreground">No categories yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => (
              <Badge
                key={cat._id}
                variant={cat.type === "general" ? "default" : "secondary"}
                className="gap-1"
              >
                {cat.name}
                <button
                  type="button"
                  onClick={() => handleDelete(cat._id)}
                  className="ml-1 hover:text-destructive cursor-pointer"
                >
                  &times;
                </button>
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface Category {
  _id: string;
  name: string;
}

function CategorySelect({
  categories,
  value,
  onValueChange,
  className,
}: {
  categories: Category[];
  value: string;
  onValueChange: (val: string) => void;
  className?: string;
}) {
  const items: Record<string, string> = { [NO_CATEGORY]: "No category" };
  for (const cat of categories) {
    items[cat._id] = cat.name;
  }

  return (
    <Select value={value} onValueChange={(val) => onValueChange(val as string)} items={items}>
      <SelectTrigger className={className}>
        <SelectValue placeholder="Category" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_CATEGORY}>No category</SelectItem>
        {categories.map((cat) => (
          <SelectItem key={cat._id} value={cat._id}>
            {cat.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
