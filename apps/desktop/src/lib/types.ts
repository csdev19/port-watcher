/** Mirror of Rust `PortEntry` (serde camelCase). Do not add fields here
 * without adding them in src-tauri/src/ports/models.rs first. */
export interface PortEntry {
  port: number;
  pid: number;
  processName: string;
  command: string;
  cwd: string | null;
  project: string | null;
  label: string;
  user: string | null;
  /** Epoch seconds; doubles as the kill guard. */
  startedAt: number;
  memoryBytes: number;
  killable: boolean;
}

/** Mirror of Rust `KillResult`. */
export type KillResult = "terminated" | "killed" | "alreadyGone" | "permissionDenied";

/** Identity key for a listening process (pid + port, not array index).
 * The list is re-sorted by (port, pid) on every poll, so an index can
 * silently point at a different row after a refetch — this key can't. */
export function portKey(entry: Pick<PortEntry, "pid" | "port">): string {
  return `${entry.pid}:${entry.port}`;
}
