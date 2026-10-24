import type { Level, MachineSnapshot } from "@/lib/machine-types";
import styles from "./full.module.css";

const MEMORY_PRESSURE: Record<Level, string> = {
  ok: "Normal",
  watch: "Warn",
  stop: "Critical",
};

interface Props {
  snapshot: MachineSnapshot | undefined;
}

/** "Right now": the latest reading of what the History chart plots, as plain words. */
export function RightNow({ snapshot }: Props) {
  const heat = snapshot?.gauges.find((g) => g.id === "heat");
  const gpu = snapshot?.gauges.find((g) => g.id === "gpu");
  const memory = snapshot?.gauges.find((g) => g.id === "memory");
  const rows: { label: string; value: string; level?: Level }[] = [
    {
      label: "Thermal pressure",
      value: heat?.available === false ? "n/a" : (heat?.value ?? "…"),
      level: heat?.level,
    },
    {
      label: "CPU hotspot",
      value: heat?.unit === "°C" ? (heat.extra ?? "n/a") : "n/a",
    },
    {
      label: "GPU",
      value: gpu?.available === false ? "n/a" : (gpu?.value ?? "…"),
    },
    {
      label: "Memory pressure",
      value: memory ? MEMORY_PRESSURE[memory.level] : "…",
      level: memory?.level,
    },
    { label: "Memory used", value: memory?.value ?? "…" },
    {
      label: "System power",
      value:
        snapshot === undefined
          ? "…"
          : snapshot.systemWatts === null
            ? "n/a"
            : `${snapshot.systemWatts.toFixed(1)} W`,
    },
  ];
  return (
    <section aria-label="Right now">
      <h2 className={styles.asideTitle}>Right now</h2>
      <dl className={styles.nowList}>
        {rows.map((r) => (
          <div key={r.label} className={styles.nowRow} data-level={r.level ?? "ok"}>
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
