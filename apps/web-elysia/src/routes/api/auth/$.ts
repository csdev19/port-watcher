import { createFileRoute } from "@tanstack/react-router";
import { createProxyHandler } from "@monorepo-template/infra-cloudflare";
import { API_URL } from "@/lib/constants";
import { apiFetch } from "@/lib/api-fetch";

const proxyToBackend = createProxyHandler({
  backendUrl: API_URL,
  fetchFn: apiFetch,
  forwardedHeaders: true,
  logPrefix: "auth-proxy",
});

export const Route = createFileRoute("/api/auth/$")({
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
