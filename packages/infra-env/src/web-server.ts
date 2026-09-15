import { z } from "zod";

// The client-server web apps proxy all auth + data requests to the backend
// API worker, so they never run Better Auth or touch the DB. The only
// server-side value they need is the backend URL to proxy to.
export const webServerEnvSchema = z.object({
  VITE_SERVER_URL: z.string().min(1),
});
