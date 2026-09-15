import { z } from "zod";
import { commaSeparatedList } from "./transforms";

export const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  CORS_ORIGIN: commaSeparatedList,
  BETTER_AUTH_SECRET: z.string().min(1),
});
