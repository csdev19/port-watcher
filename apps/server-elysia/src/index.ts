import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { auth } from "./lib/auth";
import { todoRoutes } from "./routes/todos";

// CORS only needed for mobile apps — web requests come through
// the web Worker proxy via Service Bindings (same-origin, no CORS needed)
const corsConfig = {
  origin: ["exp://", "mobile://", "exp://*"],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
  credentials: true,
  maxAge: 86400, // 24 hours
};

const authRoutes = new Elysia().use(cors(corsConfig)).mount(auth.handler);

const apiRoutes = new Elysia({
  prefix: "/api/v1",
})
  .use(cors(corsConfig))
  .use(todoRoutes)
  .get("/health", () => ({
    status: "healthy",
    timestamp: new Date().toISOString(),
  }));

const app = new Elysia({
  adapter: CloudflareAdapter,
})
  .use(authRoutes)
  .use(apiRoutes)
  .compile();

export type App = typeof app;

export default {
  fetch: (request: Request, env: CloudflareBindings, ctx: ExecutionContext) => {
    return app.fetch(request, env, ctx);
  },
};
