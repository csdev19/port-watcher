import { webClientEnvSchema } from "@monorepo-template/infra-env";

export const env = webClientEnvSchema.parse(import.meta.env);
