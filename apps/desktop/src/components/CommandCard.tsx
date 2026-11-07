import { useState } from "react";
import type { MemoryCommand } from "@/lib/types";
import styles from "./memory-panel.module.css";

interface Props {
  command: MemoryCommand;
}

/** For a process chapay may not kill: the Terminal command that frees it,
 * with a Copy button. chapay never runs it (ADR 0012). */
export function CommandCard({ command }: Props) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");

  function copy() {
    navigator.clipboard.writeText(command.text).then(
      () => setCopied("copied"),
      () => setCopied("failed"),
    );
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardCommand}>
        <code className={styles.cardText}>{command.text}</code>
        <button type="button" className={styles.cardCopy} onClick={copy}>
          {copied === "copied" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy"}
        </button>
      </div>
      <p className={styles.cardNote}>{command.note}</p>
      {command.securityVendor ? (
        <p className={styles.cardNote}>
          {command.securityVendor} security software: check your IT policy.
        </p>
      ) : null}
    </div>
  );
}
