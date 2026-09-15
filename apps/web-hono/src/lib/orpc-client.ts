import { createORPCClient } from "@orpc/client";
import type { ContractRouterClient } from "@orpc/contract";
import { OpenAPILink } from "@orpc/openapi-client/fetch";
import type { JsonifiedClient } from "@orpc/openapi-client";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { contract, type Contract } from "../../../server-hono/src/contract";

type Client = JsonifiedClient<ContractRouterClient<Contract>>;

const link = new OpenAPILink(contract, {
  url: () =>
    typeof window !== "undefined"
      ? `${window.location.origin}/api/v1`
      : "http://localhost:3000/api/v1",
  fetch: (request, init) => globalThis.fetch(request, { ...init, credentials: "include" }),
});

export const client: Client = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);
