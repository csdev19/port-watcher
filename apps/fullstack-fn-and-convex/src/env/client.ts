import { fullstackConvexClientEnvSchema } from "@monorepo-template/infra-env";

export const env = fullstackConvexClientEnvSchema.parse(import.meta.env);
