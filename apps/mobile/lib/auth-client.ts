/* eslint-disable import/no-unresolved */
import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
/* eslint-enable import/no-unresolved */
import * as SecureStore from "expo-secure-store";
import { env } from "./env";

export const authClient = createAuthClient({
  baseURL: env.EXPO_PUBLIC_API_URL,
  disableDefaultFetchPlugins: true,
  plugins: [
    expoClient({
      scheme: "mobile",
      storagePrefix: "mobile",
      storage: SecureStore,
    }),
  ],
});

export const { signIn, signUp, signOut, useSession } = authClient;
