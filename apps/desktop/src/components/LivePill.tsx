import type { ReactNode } from "react";
import styles from "@/app.module.css";

interface Props {
  tone: "live" | "idle";
  children: ReactNode;
}

/** Small outlined pill: a 5 px dot (mint when live, muted when idle) and text. */
export function LivePill({ tone, children }: Props) {
  return (
    <span className={styles.pill} data-tone={tone}>
      <span className={styles.pillDot} aria-hidden="true" />
      {children}
    </span>
  );
}
