import { z } from "zod";

export const webClientEnvSchema = z.object({
  VITE_SERVER_URL: z.url(),
});
