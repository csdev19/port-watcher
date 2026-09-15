# mobile-convex

Expo **SDK 57** example that connects to a **single Convex project that hosts both
data and auth** (`packages/convex-auth-api`) — Better Auth runs _inside_ Convex via
`@convex-dev/better-auth`, unlike `apps/mobile` (SDK 54) which uses an external auth
server. Demonstrates: a public Convex query + email/password login, all from one
Convex deployment.

> **The full knowledge lives in the general-knowledge hub** (single source of truth —
> this example just links to it):
>
> - [`convex/better-auth`](https://github.com/csdev19/general-knowledge/blob/main/convex/better-auth.md) — the auth setup + version constraints + the SDK 57 `useSession` hang fix
> - [`convex/client-connection`](https://github.com/csdev19/general-knowledge/blob/main/convex/client-connection.md) — client, providers, env, generated API in a monorepo
> - [`mobile/expo-dev-builds-and-metro`](https://github.com/csdev19/general-knowledge/blob/main/mobile/expo-dev-builds-and-metro.md) — running it (dev build vs Expo Go, rebuild vs `bun dev`, Metro)
> - [`mobile/google-maps`](https://github.com/csdev19/general-knowledge/blob/main/mobile/google-maps.md) — maps (dev build, key, Maps SDK Android + billing, SHA-1)

## Why the versions are pinned this way

This app deliberately uses `better-auth@1.6.23` + `@convex-dev/better-auth@0.12.5` +
`@better-auth/expo@1.6.23` (explicit, **not** the workspace catalog). On Expo SDK 57
/ React 19 the older stack's reactive `useSession()` never resolves and the login
hangs. The pieces that are easy to miss are already wired here:

- **`expo-network`** dependency — `@better-auth/expo@1.6.x` requires it at runtime.
- **`exp://` in `trustedOrigins`** (`packages/convex-auth-api/convex/auth.ts`) — Expo
  Go sends an `exp://host:port` origin, rejected as `Invalid origin` unless trusted.
- **`authClient as unknown as AuthClient` cast** in `src/app/_layout.tsx`.

## First-time setup

1. **Create the Convex deployment** for the auth backend (interactive — creates the
   project and runs codegen, which generates the `_generated/api` this app imports):

   ```bash
   bun --filter @monorepo-template/convex-auth-api dev:setup
   ```

2. **Set the site URL** on that deployment (Better Auth reads `process.env.SITE_URL`):

   ```bash
   cd packages/convex-auth-api
   npx convex env set SITE_URL https://<your-deployment>.convex.site
   ```

   (Or set `SITE_URL` = your `.convex.site` URL in the Convex dashboard.)

3. **Point the app at it** — copy env and fill both URLs from the deployment:

   ```bash
   cp apps/mobile-convex/.env.example apps/mobile-convex/.env
   # EXPO_PUBLIC_CONVEX_URL      = https://<deployment>.convex.cloud
   # EXPO_PUBLIC_CONVEX_SITE_URL = https://<deployment>.convex.site
   ```

## Run (with the convex dev server from step 1 still running)

```bash
# Android emulator: make localhost reachable from the emulator
adb reverse tcp:8081 tcp:8081

bun --filter mobile-convex start --host localhost
# press 'a' (Android) or 'i' (iOS). Expo Go for SDK 57 auto-installs on a simulator.
```

`--host localhost` matters on emulators — the LAN-IP default is flaky. The app's
public-query dot goes green immediately; enter an email + password and **Sign up** /
**Sign in** to exercise the Convex-hosted Better Auth.
