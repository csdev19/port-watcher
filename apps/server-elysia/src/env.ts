import { env as cfEnv } from "cloudflare:workers";
import { serverEnvSchema } from "@monorepo-template/infra-env";

export const env = serverEnvSchema.parse(cfEnv);
