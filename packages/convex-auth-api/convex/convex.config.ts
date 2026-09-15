import betterAuth from "@convex-dev/better-auth/convex.config";
import { defineApp } from "convex/server";

// Better Auth runs INSIDE Convex (unlike the sibling `convex-api`, which
// validates JWTs issued by an external auth server). This is the self-contained
// "Convex hosts data + auth" example.
const app = defineApp();
app.use(betterAuth);

export default app;
