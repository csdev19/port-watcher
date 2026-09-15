import { fullstackServerEnvSchema } from "@monorepo-template/infra-env";

export const env = fullstackServerEnvSchema.parse(process.env);
