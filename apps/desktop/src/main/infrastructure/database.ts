import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * `node:sqlite` ships with Node 24 (which Electron 44 bundles), so the app gets a
 * real SQL store with no native module to rebuild per platform — the reason this
 * template prefers it over better-sqlite3. The API is still flagged experimental
 * upstream; it needs no CLI flag, but it can change across Node majors.
 */
export function openDatabase(filePath: string): DatabaseSync {
  mkdirSync(dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);

  // WAL keeps reads from blocking on writes; foreign_keys is off by default in SQLite.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  migrate(db);
  return db;
}

/**
 * Schema setup. A template ships one table, so `IF NOT EXISTS` is enough; a real
 * app should move to versioned migrations (a `user_version` pragma plus an
 * ordered list of steps) before the first schema change reaches users.
 *
 * Column shapes mirror `packages/infra-db`'s Drizzle table so the two adapters of
 * `ITodoRepository` stay comparable: timestamps are epoch milliseconds, and
 * `completed` is 0/1 because SQLite has no boolean type.
 */
function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS todos (
      id          TEXT    PRIMARY KEY,
      title       TEXT    NOT NULL,
      completed   INTEGER NOT NULL DEFAULT 0,
      category_id TEXT,
      user_id     TEXT    NOT NULL,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS todos_user_id_idx ON todos (user_id)");
}
