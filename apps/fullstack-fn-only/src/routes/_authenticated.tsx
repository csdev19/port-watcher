import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async (ctx) => {
    const { isAuthenticated } = ctx.context;

    if (!isAuthenticated) {
      throw redirect({ to: "/auth/login" });
    }
  },
});
