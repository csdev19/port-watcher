import type { ConvexQueryClient } from "@convex-dev/react-query";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

// Create a new QueryClient per request (required for SSR)
export function createQueryClient(convexQueryClient: ConvexQueryClient) {
  return new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        queryFn: convexQueryClient.queryFn(),
      },
    },
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
