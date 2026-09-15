import { db } from "@monorepo-template/infra-db/client";
import { userTable, accountTable, sessionTable } from "@monorepo-template/infra-db/schemas";
import type { BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { randomBytes, scryptSync } from "node:crypto";

export const baseConfig: BetterAuthOptions = {
  appName: "Monorepo Template",
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user: userTable, account: accountTable, session: sessionTable },
  }),
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 10 * 60, // Cache duration in seconds (10 minutes)
    },
  },
  emailAndPassword: {
    enabled: true,
    password: {
      /**
       * Hash password using scrypt from node:crypto
       */
      hash: async (password: string): Promise<string> => {
        const salt = randomBytes(16).toString("hex");
        const hash = scryptSync(password, salt, 64).toString("hex");
        return `${salt}:${hash}`;
      },

      /**
       * Verify password against hash
       */
      verify: async ({ hash, password }: { hash: string; password: string }): Promise<boolean> => {
        const [salt, key] = hash.split(":");
        if (!salt || !key) return false;

        const keyBuffer = Buffer.from(key, "hex");
        const hashBuffer = scryptSync(password, salt, 64);
        return keyBuffer.equals(hashBuffer);
      },
      // acording to chatgpt more secure, let's test this later
      // hash: async (password: string): Promise<string> => {
      //   const salt = randomBytes(16); // raw Buffer
      //   const hash = scryptSync(password, salt, 64); // raw Buffer

      //   // Combine them and encode in base64
      //   const combined = Buffer.concat([salt, hash]); // total length: 16 + 64 = 80 bytes
      //   return combined.toString('base64'); // safe to store
      // },

      // verify: async ({
      //   hash: stored,
      //   password,
      // }: {
      //   hash: string;
      //   password: string;
      // }): Promise<boolean> => {
      //   const combined = Buffer.from(stored, 'base64');
      //   const salt = combined.subarray(0, 16); // first 16 bytes
      //   const key = combined.subarray(16); // remaining 64 bytes

      //   const hashBuffer = scryptSync(password, salt, 64);

      //   return timingSafeEqual(key, hashBuffer);
      // },
    },
  },
  advanced: {
    defaultCookieAttributes: {
      sameSite: "none",
      secure: true,
      httpOnly: true,
    },
  },
  // plugins: [customSession(getCustomSession)],
  plugins: [],
};

// export const options = {
//   plugins: [customSession(getCustomSession)],
// } satisfies BetterAuthOptions;
