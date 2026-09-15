import { query } from "./_generated/server";

/** Public query — proves the Convex connection works with no auth. */
export const get = query({
  handler: async () => {
    return "OK";
  },
});
