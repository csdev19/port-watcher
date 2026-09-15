import { StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useSession, signOut } from "@/lib/auth-client";

export default function ProfileScreen() {
  const { data: session, isPending } = useSession();

  const handleSignOut = async () => {
    try {
      await signOut();
      router.replace("/(auth)/sign-in");
    } catch (err) {
      Alert.alert("Error", "Failed to sign out");
      console.error(err);
    }
  };

  if (isPending) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.container}>
          <ActivityIndicator size="large" color="#0a7ea4" />
        </ThemedView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ThemedView style={styles.container}>
        <ThemedText type="title" style={styles.title}>
          Profile
        </ThemedText>

        <ThemedView style={styles.infoCard}>
          {session?.user?.name && <ThemedText type="subtitle">{session.user.name}</ThemedText>}
          {session?.user?.email && (
            <ThemedText style={styles.email}>{session.user.email}</ThemedText>
          )}
        </ThemedView>

        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
          <ThemedText style={styles.signOutButtonText}>Sign Out</ThemedText>
        </TouchableOpacity>
      </ThemedView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
    padding: 16,
  },
  title: {
    marginBottom: 24,
  },
  infoCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(128, 128, 128, 0.2)",
    gap: 4,
  },
  email: {
    opacity: 0.7,
    fontSize: 14,
  },
  signOutButton: {
    marginTop: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#dc2626",
    borderRadius: 8,
    alignItems: "center",
  },
  signOutButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
