import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useSession } from "@/lib/auth-client";
import { Colors } from "@/constants/theme";

export default function HomeScreen() {
  const { data: session, isPending } = useSession();

  return (
    <SafeAreaView style={styles.safeArea}>
      <ThemedView style={styles.container}>
        <ThemedView style={styles.header}>
          <ThemedText type="title">Home</ThemedText>
        </ThemedView>

        <ThemedView style={styles.centered}>
          {isPending ? (
            <ThemedText style={styles.loadingText}>Loading...</ThemedText>
          ) : session?.user ? (
            <>
              <ThemedText type="subtitle">Welcome, {session.user.name}</ThemedText>
              <ThemedText style={styles.subtext}>
                This is the monorepo template home screen.
              </ThemedText>
            </>
          ) : (
            <>
              <ThemedText type="subtitle">Welcome</ThemedText>
              <ThemedText style={styles.subtext}>Sign in to get started.</ThemedText>
            </>
          )}
        </ThemedView>
      </ThemedView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  container: {
    flex: 1,
    padding: 16,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 12,
    marginBottom: 24,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    opacity: 0.7,
  },
  subtext: {
    opacity: 0.7,
    marginTop: 8,
  },
});
