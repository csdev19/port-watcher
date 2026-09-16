import { fullstackServerEnvSchema } from "@port-watcher/infra-env";

export const env = fullstackServerEnvSchema.parse(process.env);
