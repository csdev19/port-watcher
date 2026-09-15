import { createFileRoute } from "@tanstack/react-router";
import { createProxyHandler } from "@monorepo-template/infra-cloudflare";
import { env } from "@/env/server";
import { apiFetch } from "@/lib/api-fetch";

const proxyToBackend = createProxyHandler({
  backendUrl: env.VITE_SERVER_URL,
  fetchFn: apiFetch,
  logPrefix: "api-proxy",
});

export const Route = createFileRoute("/api/v1/$")({
  server: {
    handlers: {
      GET: async ({ request }) => proxyToBackend(request),
      POST: async ({ request }) => proxyToBackend(request),
      PUT: async ({ request }) => proxyToBackend(request),
      PATCH: async ({ request }) => proxyToBackend(request),
      DELETE: async ({ request }) => proxyToBackend(request),
    },
  },
});
