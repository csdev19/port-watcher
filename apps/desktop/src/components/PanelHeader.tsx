import { BrandMark } from "@/components/BrandMark";
import { LivePill } from "@/components/LivePill";
import styles from "@/app.module.css";

interface Props {
  /** Number of listening ports in the current snapshot. */
  count: number;
}

export function PanelHeader({ count }: Props) {
  return (
    <header className={styles.header}>
      <BrandMark />
      <LivePill tone={count > 0 ? "live" : "idle"}>{count} listening</LivePill>
    </header>
  );
}
