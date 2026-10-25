import type { ReactNode } from "react";
import styles from "@/app.module.css";

interface Props {
  /** `live`/`idle` for the Ports count; `ok`/`watch`/`stop` for the System health verdict. */
  tone: "live" | "idle" | "ok" | "watch" | "stop";
  children: ReactNode;
  /** Full spoken text when the visible word is short ("Stop" plus its reasons). */
  ariaLabel?: string;
}

/** Small outlined pill: a 5 px dot (mint when live or ok, yellow for watch, red for stop,
 * muted when idle) and text. With an `ariaLabel` it is a polite live region, so a change of
 * verdict is announced once; the visible text only changes when the level does. */
export function LivePill({ tone, children, ariaLabel }: Props) {
  return (
    <span
      className={styles.pill}
      data-tone={tone}
      {...(ariaLabel
        ? {
            role: "status",
            "aria-live": "polite" as const,
            "aria-label": ariaLabel,
          }
        : {})}
    >
      <span className={styles.pillDot} aria-hidden="true" />
      {children}
    </span>
  );
}
