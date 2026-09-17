import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import ws from "ws";

import * as schema from "../schema";

neonConfig.webSocketConstructor = ws;

// To work in edge environments (Cloudflare Workers, Vercel Edge, etc.), enable querying over fetch
// neonConfig.poolQueryViaFetch = true
// TEMP (local only, do not commit): DATABASE_URL isn't set locally, and an
// eager `neon()` call crashes the whole SSR bundle on import for routes that
// never touch the DB (e.g. the landing page). Lazily construct the real
// client only the first time `db` is actually used.
let _db: ReturnType<typeof drizzle> | undefined;
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop) {
    if (!_db) {
      const sql = neon(process.env.DATABASE_URL || "");
      _db = drizzle(sql, { schema });
    }
    return _db[prop as keyof typeof _db];
  },
});

export const createDatabaseClient = (databaseUrl: string) => {
  const sql = neon(databaseUrl);
  return drizzle(sql, { schema });
};

export type DatabaseClient = ReturnType<typeof createDatabaseClient>;
