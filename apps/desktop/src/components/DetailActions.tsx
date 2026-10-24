import { useEffect, useRef, useState } from "react";
import type { PortEntry } from "@/lib/types";
import { openLocalUrl } from "@/lib/ports";
import { Icon, type IconName } from "@/components/Icon";
import styles from "@/app.module.css";

interface Props {
  entry: PortEntry;
}

/** Quiet action buttons under the expanded row: open `localhost:PORT` for dev
 * rows (otherwise copy the port number) and copy the pid. Clicks never bubble,
 * so using one does not collapse the row. "Reveal in Finder" is not offered:
 * it would need a broader opener permission than the panel is granted. */
export function DetailActions({ entry }: Props) {
  const [copied, setCopied] = useState<"port" | "pid" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  function copy(kind: "port" | "pid", value: number) {
    void navigator.clipboard
      .writeText(String(value))
      .then(() => {
        setCopied(kind);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(null), 1200);
      })
      .catch(() => {});
  }

  function button(label: string, icon: IconName, onClick: () => void) {
    return (
      <button
        type="button"
        className={styles.detailAction}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        <Icon name={icon} size={13} />
        {label}
      </button>
    );
  }

  return (
    <div className={styles.detailActions}>
      {entry.category === "dev"
        ? button(`localhost:${entry.port}`, "external-link", () => void openLocalUrl(entry.port))
        : button(copied === "port" ? "Copied" : "Copy port", "copy", () =>
            copy("port", entry.port),
          )}
      {button(copied === "pid" ? "Copied" : "Copy pid", "copy", () => copy("pid", entry.pid))}
    </div>
  );
}
