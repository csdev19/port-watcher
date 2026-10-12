import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { routerWithQueryClient } from "@tanstack/react-router-with-query";

import Loader from "./components/loader";
import { routeTree } from "./routeTree.gen";
import { createQueryClient } from "./lib/query-client";

export const getRouter = () => {
  const queryClient = createQueryClient();
  const router = routerWithQueryClient(
    createTanStackRouter({
      routeTree,
      scrollRestoration: true,
      defaultPreloadStaleTime: 0,
      // isAuthenticated and session are disabled with auth (see vite.config.ts).
      context: { queryClient /* , isAuthenticated: false, session: null */ },
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
