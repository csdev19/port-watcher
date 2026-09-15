import { ConvexReactClient } from "convex/react";

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;

if (!convexUrl) {
  throw new Error(
    "Missing EXPO_PUBLIC_CONVEX_URL. Copy .env.example to .env and point it at the convex-auth-api deployment.",
  );
}

/** Single Convex client. Reactivity + auth are wired via ConvexBetterAuthProvider. */
export const convex = new ConvexReactClient(convexUrl, {
  unsavedChangesWarning: false,
});
