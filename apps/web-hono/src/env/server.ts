import { webServerEnvSchema } from "@monorepo-template/infra-env";

export const env = webServerEnvSchema.parse(process.env);
