import { ConvexBetterAuthProvider, type AuthClient } from "@convex-dev/better-auth/react";
import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useColorScheme } from "react-native";

import { AnimatedSplashOverlay } from "@/components/animated-icon";
import AppTabs from "@/components/app-tabs";
import { authClient } from "@/lib/auth-client";
import { convex } from "@/lib/convex";

SplashScreen.preventAutoHideAsync();

export default function TabLayout() {
  const colorScheme = useColorScheme();
  return (
    // Cast: the Expo `expoClient()` plugin infers a useSession().data shape the
    // provider's AuthClient type rejects at compile time, though it works at
    // runtime. Known upstream: github.com/get-convex/better-auth/issues/168
    <ConvexBetterAuthProvider client={convex} authClient={authClient as unknown as AuthClient}>
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        <AppTabs />
      </ThemeProvider>
    </ConvexBetterAuthProvider>
  );
}
