import type { PortEntry } from "@/lib/types";
import { formatMemory, formatUptime, middleTruncate } from "@/lib/format";
import { DetailActions } from "@/components/DetailActions";
import { Icon } from "@/components/Icon";
import styles from "@/app.module.css";

interface Props {
  entry: PortEntry;
  selected: boolean;
  expanded: boolean;
  /** Owned by App's shared `useKillConfirm` — true while this row's key
   * is the armed target (F6 Slice 2: pointer and keyboard share one
   * confirmation instance so neither path can bypass the other). */
  armed: boolean;
  onSelect: () => void;
  onToggleExpand: () => void;
  onRequestKill: () => void;
  onDisarm: () => void;
  /** F7 Slice 4: true while the live snapshot backing this row is stale
   * (a background refetch failed and we're showing retained data). The
   * kill control is disabled — real, native `disabled`, not just a
   * no-op handler — so it can never be armed/confirmed against
   * out-of-date liveness, keyboard or pointer. */
  killDisabled?: boolean;
  /** F7 Slice 3: whether this port is currently saved as a favourite.
   * An undefined `onToggleWatch` hides the star entirely — used by
   * contexts (e.g. Favourites' own listener rows) that don't offer a
   * per-row watch action. */
  watched?: boolean;
  onToggleWatch?: () => void;
  /** `secondary` is the compact Apps & system row: muted 15px port, one
   * 12.5px label line, no meta line. Defaults to the full dev row. */
  variant?: "dev" | "secondary";
}

const META_WIDTH = 34;
const MIN_PATH_WIDTH = 12;

/** Second line of a dev row: `<project> · <path>`. The project is shown only
 * when it adds something (it differs from the folder's own name), and it is
 * never truncated: the path gives up room instead. */
function projectAndPath(project: string | null, cwd: string): string {
  const folder = cwd.split("/").filter(Boolean).pop();
  if (!project || project === folder) return middleTruncate(cwd, META_WIDTH);
  const room = Math.max(META_WIDTH - project.length - 3, MIN_PATH_WIDTH);
  return `${project} · ${middleTruncate(cwd, room)}`;
}

export function PortRow({
  entry,
  selected,
  expanded,
  armed,
  onSelect,
  onToggleExpand,
  onRequestKill,
  onDisarm,
  killDisabled,
  watched,
  onToggleWatch,
  variant = "dev",
}: Props) {
  const protectedCategory = entry.category !== "dev";
  const secondary = variant === "secondary";
  const confirmLabel = entry.category === "system" ? "Kill system?" : "Kill app?";

  return (
    <li
      className={[styles.row, selected && styles.rowSelected, secondary && styles.rowSecondary]
        .filter(Boolean)
        .join(" ")}
      onMouseEnter={onSelect}
      onClick={onToggleExpand}
      role="option"
      aria-selected={selected}
    >
      <div className={styles.rowMain}>
        <span className={protectedCategory ? `${styles.port} ${styles.portMuted}` : styles.port}>
          {entry.port}
        </span>
        <div className={styles.rowCenter}>
          <span className={styles.label}>{entry.label}</span>
          {!secondary && (
            <span className={styles.meta}>
              {protectedCategory
                ? middleTruncate(
                    entry.appBundlePath ?? entry.executablePath ?? entry.processName,
                    34,
                  )
                : entry.cwd
                  ? projectAndPath(entry.project, entry.cwd)
                  : (entry.project ?? entry.processName)}
            </span>
          )}
        </div>
        <div className={styles.actions}>
          {onToggleWatch && (
            <button
              type="button"
              className={watched ? styles.watchActive : `${styles.watch} ${styles.reveal}`}
              aria-label={watched ? `Port ${entry.port} is watched` : `Watch port ${entry.port}`}
              aria-pressed={watched ?? false}
              onClick={(e) => {
                e.stopPropagation();
                onToggleWatch();
              }}
            >
              <Icon name="star" />
            </button>
          )}
          <span className={styles.uptime}>{formatUptime(entry.startedAt)}</span>
          {entry.killable ? (
            <button
              type="button"
              disabled={killDisabled}
              aria-disabled={killDisabled || undefined}
              className={
                killDisabled
                  ? `${styles.killDisabled} ${styles.reveal}`
                  : armed
                    ? protectedCategory
                      ? styles.killArmedNeutral
                      : styles.killArmed
                    : `${protectedCategory ? styles.killNeutral : styles.kill} ${styles.reveal}`
              }
              aria-label={
                killDisabled
                  ? `Cannot kill ${entry.label} on port ${entry.port}: status is stale`
                  : `Kill ${entry.label} on port ${entry.port}`
              }
              onClick={(e) => {
                e.stopPropagation();
                if (killDisabled) return;
                onRequestKill();
              }}
              onMouseLeave={onDisarm}
            >
              {killDisabled ? (
                <Icon name="x" />
              ) : armed ? (
                protectedCategory ? (
                  confirmLabel
                ) : (
                  "Kill?"
                )
              ) : (
                <Icon name="x" />
              )}
            </button>
          ) : (
            <span
              className={styles.lock}
              data-tooltip="Belongs to another user"
              aria-label="Belongs to another user"
            >
              <Icon name="lock" />
            </span>
          )}
        </div>
      </div>
      {expanded && (
        <div className={styles.detail} onClick={(e) => e.stopPropagation()}>
          <div className={styles.detailMeta}>
            <span>
              pid <span className={styles.detailValue}>{entry.pid}</span>
            </span>
            <span>
              user <span className={styles.detailValue}>{entry.user ?? "—"}</span>
            </span>
            <span>
              mem <span className={styles.detailValue}>{formatMemory(entry.memoryBytes)}</span>
            </span>
          </div>
          <div className={styles.command}>{entry.command}</div>
          <DetailActions entry={entry} />
        </div>
      )}
    </li>
  );
}
