import { useMemo, useState } from "react";
import type { GaugeId, MachineSnapshot, Metric, Range } from "@/lib/machine-types";
import { joinPorts } from "@/lib/process-table";
import { HistoryChart } from "@/components/charts/HistoryChart";
import { ProcessTable } from "@/components/ProcessTable";
import type { ToastData } from "@/components/Toast";
import { useMachineHistory } from "@/hooks/use-machine-history";
import { useProcesses } from "@/hooks/use-processes";
import { usePorts } from "@/hooks/use-ports";
import styles from "./full.module.css";

type ChartChoice = "cpu" | "gpu" | "memory" | "heat";

const CHOICES: { id: ChartChoice; label: string }[] = [
  { id: "cpu", label: "CPU" },
  { id: "gpu", label: "GPU" },
  { id: "memory", label: "Memory" },
  { id: "heat", label: "Heat" },
];

const RANGES: { id: Range; label: string }[] = [
  { id: "1m", label: "1 min" },
  { id: "10m", label: "10 min" },
  { id: "1h", label: "1 h" },
];

const GAUGE_FOR: Record<ChartChoice, GaugeId> = {
  cpu: "cpu",
  gpu: "gpu",
  memory: "memory",
  heat: "heat",
};

interface Props {
  snapshot: MachineSnapshot | undefined;
  onToast: (toast: ToastData) => void;
}

/** Overview: one history chart with a metric switch and a range, then the process table. */
export function OverviewPage({ snapshot, onToast }: Props) {
  const [choice, setChoice] = useState<ChartChoice>("cpu");
  const [range, setRange] = useState<Range>("10m");

  const gauge = snapshot?.gauges.find((g) => g.id === GAUGE_FOR[choice]);
  // Heat charts the CPU hotspot; on a Mac without the sensor it charts the pressure level.
  const heatByLevel = choice === "heat" && gauge?.unit === "level";
  const metric: Metric =
    choice === "memory"
      ? "memoryUsed"
      : choice === "heat"
        ? heatByLevel
          ? "thermalLevel"
          : "hotspot"
        : choice;
  const series = useMachineHistory(metric, range);
  const strip = useMachineHistory("thermalLevel", range, choice === "heat" && !heatByLevel);

  const processes = useProcesses();
  const ports = usePorts();
  const rows = useMemo(
    () => joinPorts(processes.data ?? [], ports.data ?? []),
    [processes.data, ports.data],
  );
  const cpuWarn = snapshot?.gauges.find((g) => g.id === "cpu")?.warn ?? null;
  const label = CHOICES.find((c) => c.id === choice)!.label;

  return (
    <div className={styles.overview}>
      <section className={styles.card} aria-label="History">
        <div className={styles.chartBar}>
          <div className={styles.segmented} role="group" aria-label="Metric">
            {CHOICES.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={choice === c.id}
                onClick={() => setChoice(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className={styles.segmented} role="group" aria-label="Range">
            {RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                aria-pressed={range === r.id}
                onClick={() => setRange(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <HistoryChart
          series={series.data}
          gauge={gauge}
          strip={choice === "heat" && !heatByLevel ? strip.data : undefined}
          showCulprit={choice === "cpu" || choice === "heat"}
          label={`${label} history`}
        />
        {choice === "heat" && !heatByLevel && (
          <p className={styles.note}>Line: CPU hotspot. Strip: macOS thermal pressure.</p>
        )}
        <p className={styles.note}>
          chapay samples only while it is open, or while a CPU or GPU alert is on.
        </p>
      </section>

      <section className={styles.card} aria-label="Processes">
        <ProcessTable
          rows={rows}
          loading={processes.isLoading || processes.isFetching}
          error={processes.error}
          cpuWarn={cpuWarn}
          onToast={onToast}
        />
      </section>
    </div>
  );
}
