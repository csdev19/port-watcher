import { BrandMark } from "@/components/BrandMark";
import { LivePill } from "@/components/LivePill";
import type { Level } from "@/lib/machine-types";
import styles from "@/app.module.css";

interface Props {
  /** Number of listening ports in the current snapshot. */
  count: number;
  /** System health verdict. When given (Machine tab) the pill shows it instead of the count. */
  verdict?: { level: Level; reasons: string[] } | null;
}

const WORD: Record<Level, string> = { ok: "OK", watch: "Watch", stop: "Stop" };

export function PanelHeader({ count, verdict }: Props) {
  return (
    <header className={styles.header}>
      <BrandMark />
      {verdict ? (
        <LivePill
          tone={verdict.level}
          ariaLabel={`System health: ${WORD[verdict.level]}${
            verdict.reasons.length ? `. ${verdict.reasons.join(". ")}` : ""
          }`}
        >
          {WORD[verdict.level]}
        </LivePill>
      ) : (
        <LivePill tone={count > 0 ? "live" : "idle"}>{count} listening</LivePill>
      )}
    </header>
  );
}
