import { Elysia } from "elysia";
import { UnauthorizedError } from "@/utils/errors";
import { auth } from "@/lib/auth";

/**
 * Authentication macro plugin
 *
 * Usage:
 * ```typescript
 * import { authMacro } from './plugins/auth.plugin';
 *
 * const app = new Elysia()
 *   .use(authMacro)
 *   .get('/protected', ({ user }) => user, {
 *     isAuth: true
 *   })
 *   .get('/admin-only', ({ user }) => user, {
 *     isAuth: true,
 *     role: 'admin'
 *   });
 * ```
 */
export const authMacro = new Elysia({ name: "auth-macro" }).error({ UnauthorizedError }).macro({
  isAuth: {
    async resolve({ request: { headers } }) {
      const session = await auth.api.getSession({ headers });
      if (!session) throw new UnauthorizedError();

      return {
        user: session.user,
        session: session.session,
      };
    },
  },
  /**
   * Example permission/role checker macro
   *
   * This is a placeholder implementation - customize based on your role system
   *
   * Usage:
   * ```typescript
   * .get('/admin', ({ user }) => user, {
   *   isAuth: true,
   *   role: 'admin'  // Will check if user has 'admin' role
   * })
   * ```
   *
   * TODO: Implement actual role checking logic based on your user model
   * - Fetch user roles from database
   * - Check against session user
   * - Throw ForbiddenError if role doesn't match
   */
  // role(role: "user" | "admin" | {}) {
  //   return {
  //     // eslint-disable-next-line @typescript-eslint/no-explicit-any
  //     beforeHandle(context: any) {
  //       // Example implementation - replace with actual role checking logic
  //       // Access user from context (added by isAuth macro's resolve)
  //       const user = context.user as { id: string; role?: string } | undefined;

  //       // Option 1: Check role from session user
  //       // if (user?.role !== role) {
  //       //   throw new ForbiddenError(`Requires ${role} role`);
  //       // }
  //       //
  //       // Option 2: Fetch from database
  //       // const userWithRoles = await db.query.users.findFirst({
  //       //   where: eq(users.id, user.id),
  //       //   with: { roles: true }
  //       // });
  //       // if (!userWithRoles?.roles.some(r => r.name === role)) {
  //       //   throw new ForbiddenError(`Requires ${role} role`);
  //       // }

  //       // Remove this and add actual implementation when ready
  //     },
  //   };
  // },
});
