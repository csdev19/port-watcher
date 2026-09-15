import { convexClient } from "@convex-dev/better-auth/client/plugins";
import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/react";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

// Auth requests hit the Convex *site* URL (.convex.site), where Better Auth
// serves its /api/auth/* routes — not the .convex.cloud data URL.
const authBaseURL = process.env.EXPO_PUBLIC_CONVEX_SITE_URL;

if (!authBaseURL) {
  throw new Error(
    "Missing EXPO_PUBLIC_CONVEX_SITE_URL. Copy .env.example to .env (see the convex-auth-api deployment).",
  );
}

const scheme = Constants.expoConfig?.scheme;
const schemeName = Array.isArray(scheme) ? scheme[0] : scheme;

export const authClient = createAuthClient({
  baseURL: authBaseURL,
  plugins: [
    // Encrypted on-device session storage + deep-link handling for native.
    expoClient({
      scheme: schemeName,
      storagePrefix: schemeName,
      storage: SecureStore,
    }),
    convexClient(),
  ],
});
