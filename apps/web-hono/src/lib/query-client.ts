import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

// Create a new QueryClient per request (required for SSR)
export function createQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        toast.error(`Error: ${error.message}`, {
          action: {
            label: "retry",
            onClick: query.invalidate,
          },
        });
      },
    }),
  });
}
