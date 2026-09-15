import { treaty } from "@elysiajs/eden";
import type { App } from "../../../server-elysia/src/index";

export const clientTreaty = treaty<App>(
  typeof window !== "undefined" ? window.location.origin : "http://localhost:3002",
  {
    fetch: {
      credentials: "include",
    },
  },
);
