import { baseConfig, getCustomSession } from "@monorepo-template/infra-auth";
import { betterAuth } from "better-auth";
import { customSession } from "better-auth/plugins";
import { expo } from "@better-auth/expo";
import { env } from "../env";

export const auth = betterAuth({
  ...baseConfig,
  trustedOrigins: [...env.CORS_ORIGIN, "exp://", "mobile://", "exp://*"],
  plugins: [...(baseConfig.plugins ?? []), customSession(getCustomSession, baseConfig), expo()],
});
