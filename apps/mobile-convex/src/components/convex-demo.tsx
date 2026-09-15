import { useConvexAuth, useQuery } from "convex/react";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { api } from "@monorepo-template/convex-auth-api/convex/_generated/api";
import { authClient } from "@/lib/auth-client";

/**
 * Single-screen demo of the "Convex hosts data + auth" setup:
 *   - a PUBLIC query (categories.list) — no auth needed, proves the connection;
 *   - the Better Auth session state + an email/password login form.
 */
export function ConvexDemo() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const session = authClient.useSession();
  const categories = useQuery(api.categories.list, {});

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: "signIn" | "signUp") {
    setError(null);
    setBusy(true);
    try {
      const res =
        kind === "signIn"
          ? await authClient.signIn.email({ email: email.trim(), password })
          : await authClient.signUp.email({ email: email.trim(), password, name: email.trim() });
      if (res.error) setError(res.error.message ?? "Auth error");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Convex + Auth (one project)</Text>

      {/* Public data */}
      <View style={styles.card}>
        <Row ok={categories !== undefined}>
          {categories === undefined
            ? "Loading public categories…"
            : `Public query OK · ${categories.length} categories`}
        </Row>
      </View>

      {/* Auth state */}
      <View style={styles.card}>
        <Row ok={!isLoading}>
          useConvexAuth → isLoading: {String(isLoading)} · isAuthenticated:{" "}
          {String(isAuthenticated)}
        </Row>
        <Row ok={!session.isPending}>
          useSession → isPending: {String(session.isPending)} · user:{" "}
          {session.data?.user?.email ?? "—"}
        </Row>

        {isAuthenticated ? (
          <Pressable style={[styles.btn, styles.outline]} onPress={() => authClient.signOut()}>
            <Text>Sign out</Text>
          </Pressable>
        ) : (
          <>
            <TextInput
              style={styles.input}
              placeholder="email"
              placeholderTextColor="#9ca3af"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <TextInput
              style={styles.input}
              placeholder="password (8+)"
              placeholderTextColor="#9ca3af"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
            <View style={styles.btnRow}>
              <Pressable style={[styles.btn, styles.primary]} onPress={() => run("signIn")}>
                <Text style={styles.primaryText}>Sign in</Text>
              </Pressable>
              <Pressable style={[styles.btn, styles.outline]} onPress={() => run("signUp")}>
                <Text>Sign up</Text>
              </Pressable>
            </View>
          </>
        )}

        {busy ? <ActivityIndicator /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </View>
  );
}

function Row({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <View style={[styles.dot, { backgroundColor: ok ? "#22c55e" : "#f59e0b" }]} />
      <Text style={styles.rowText}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12, padding: 16 },
  title: { fontSize: 18, fontWeight: "700" },
  card: { gap: 10, padding: 16, borderRadius: 12, backgroundColor: "#f3f4f6" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowText: { flex: 1, fontSize: 13, color: "#111827" },
  dot: { width: 10, height: 10, borderRadius: 5 },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#111827",
    backgroundColor: "#fff",
  },
  btnRow: { flexDirection: "row", gap: 8 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: "center" },
  primary: { backgroundColor: "#208AEF" },
  primaryText: { color: "#fff", fontWeight: "600" },
  outline: { borderWidth: 1, borderColor: "#d1d5db" },
  error: { color: "#ef4444" },
});
