import { createServiceFetch } from "@monorepo-template/infra-cloudflare";

export const apiFetch = createServiceFetch(async () => {
  try {
    const { env } = await import("cloudflare:workers");
    return env.API_SERVICE ?? null;
  } catch {
    return null;
  }
});
