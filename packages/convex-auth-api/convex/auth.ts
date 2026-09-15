import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { expo } from "@better-auth/expo";
import { betterAuth } from "better-auth";

import type { DataModel } from "./_generated/dataModel";

import { components } from "./_generated/api";
import { query } from "./_generated/server";
import authConfig from "./auth.config";

const siteUrl = process.env.SITE_URL!;

export const authComponent = createClient<DataModel>(components.betterAuth);

function createAuth(ctx: GenericCtx<DataModel>) {
  return betterAuth({
    baseURL: siteUrl,
    // Trust every client origin:
    //   siteUrl         → the deployed .convex.site (production / web).
    //   mobileconvex://  → the standalone/dev-build deep-link scheme.
    //   exp://           → Expo Go, whose requests carry exp://host:port and are
    //                      only auto-trusted when NODE_ENV=development (a Convex
    //                      deployment is not). Required for local Expo Go dev.
    trustedOrigins: [siteUrl, "mobileconvex://", "exp://"],
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    plugins: [
      convex({
        authConfig,
        jwksRotateOnTokenGenerationError: true,
      }),
      // Enables the Expo / React Native client (@better-auth/expo).
      expo(),
    ],
  });
}

export { createAuth };

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    return await authComponent.safeGetAuthUser(ctx);
  },
});
