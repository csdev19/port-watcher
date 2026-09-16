/** Coarse uptime, one unit only — this is a scan column, not a stopwatch. */
export function formatUptime(startedAtSecs: number, nowMs: number = Date.now()): string {
  if (startedAtSecs <= 0) return "—";
  const secs = Math.max(0, Math.floor(nowMs / 1000 - startedAtSecs));
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}

export function formatMemory(bytes: number): string {
  if (bytes <= 0) return "—";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

/** Design brief: paths truncate in the middle — the end identifies them. */
export function middleTruncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const keep = max - 1;
  const head = Math.ceil(keep * 0.4);
  const tail = keep - head;
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}
