import { os, ORPCError } from "@orpc/server";
import { auth } from "../lib/auth";

export const authMiddleware = os
  .$context<{ headers: Headers }>()
  .middleware(async ({ context, next }) => {
    const session = await auth.api.getSession({ headers: context.headers });

    if (!session?.user) {
      throw new ORPCError("UNAUTHORIZED");
    }

    return next({
      context: { user: session.user, session: session.session },
    });
  });
