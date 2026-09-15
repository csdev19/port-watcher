import { ConvexQueryClient } from "@convex-dev/react-query";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { routerWithQueryClient } from "@tanstack/react-router-with-query";

import Loader from "./components/loader";
import { env } from "./env/client";
import { createQueryClient } from "./lib/query-client";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const convexQueryClient = new ConvexQueryClient(env.VITE_CONVEX_URL);
  const queryClient = createQueryClient(convexQueryClient);
  convexQueryClient.connect(queryClient);

  const router = routerWithQueryClient(
    createTanStackRouter({
      routeTree,
      scrollRestoration: true,
      defaultPreloadStaleTime: 0,
      context: {
        queryClient,
        convexQueryClient,
        isAuthenticated: false,
        session: null,
      },
      defaultPendingComponent: () => <Loader />,
      defaultNotFoundComponent: () => <div>Not Found</div>,
    }),
    queryClient,
  );
  return router;
};

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
