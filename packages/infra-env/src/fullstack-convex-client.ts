import { z } from "zod";

export const fullstackConvexClientEnvSchema = z.object({
  VITE_CONVEX_URL: z.url(),
});
