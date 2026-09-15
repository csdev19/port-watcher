import { httpRouter } from "convex/server";

import { authComponent, createAuth } from "./auth";

const http = httpRouter();

// Registers the Better Auth HTTP routes (/api/auth/*) on the Convex deployment.
authComponent.registerRoutes(http, createAuth);

export default http;
