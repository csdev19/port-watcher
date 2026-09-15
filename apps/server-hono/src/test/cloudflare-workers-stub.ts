// The real `cloudflare:workers` module only exists in the workerd runtime and
// would crash under Node/Vitest. `vitest.integration.config.ts` aliases the
// import to this file, so `src/env.ts` reads configuration from `process.env`
// (populated from `.env.test`) instead of a Worker binding.
export const env = globalThis.process.env;
