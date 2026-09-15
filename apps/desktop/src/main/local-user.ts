/**
 * `ITodoRepository` scopes every operation by `userId` because the server-side
 * adapter serves many accounts. This app is local-first and has no accounts, so
 * every row belongs to one synthetic owner.
 *
 * Keeping the port's shape rather than forking it is deliberate: the use cases in
 * `@monorepo-template/application` stay usable verbatim, and if the app later
 * gains sign-in (see the Better Auth `bearer` approach in the README), this
 * constant becomes the real user id with no change to the adapter.
 */
export const LOCAL_USER_ID = "local-user";
