import type { GaugeDto, HistoryPoint } from "@/lib/machine-types";
import { GAUGE_LABELS, bandText, gaugeAriaLabel } from "@/lib/gauges";
import { seriesFor, summarize } from "@/lib/sparkline";
import { Sparkline } from "@/components/Sparkline";
import styles from "@/machine.module.css";

interface Props {
  gauge: GaugeDto;
  history: HistoryPoint[];
  nowMs: number;
}

/** One gauge row: the number, what drives it, the reference band in words, and a 60 s
 * sparkline. Heat leads with the hotspot degrees (the pressure word can stay "nominal" while
 * the chip is already past the stop line). The level is always also said in the accessible
 * name; colour is never the only signal. */
export function Gauge({ gauge, history, nowMs }: Props) {
  const label = GAUGE_LABELS[gauge.id];
  const big = gauge.id === "heat" && gauge.extra ? gauge.extra : gauge.value;
  const small = gauge.id === "heat" && gauge.extra ? gauge.value : null;
  const summary = gauge.available
    ? summarize(
        seriesFor(gauge, history).map((p) => p.value),
        gauge.unit,
      )
    : "";
  return (
    <div
      role="group"
      aria-label={gaugeAriaLabel(gauge)}
      className={styles.gauge}
      data-gauge={gauge.id}
      data-level={gauge.available ? gauge.level : "off"}
    >
      <div className={styles.gaugeHead}>
        <span className={styles.gaugeLabel}>{label}</span>
        <span className={styles.gaugeValue} data-size={big.length > 7 ? "small" : "normal"}>
          {big}
        </span>
      </div>
      <div className={styles.gaugeBody}>
        <span className={styles.gaugeDriver}>
          {small && <strong className={styles.gaugeWord}>{small} · </strong>}
          {gauge.available ? gauge.driver : (gauge.unavailableReason ?? "Not available")}
        </span>
        <span className={styles.gaugeBand}>{gauge.available ? bandText(gauge) : ""}</span>
      </div>
      {gauge.available ? (
        history.length > 1 ? (
          <Sparkline gauge={gauge} history={history} nowMs={nowMs} />
        ) : (
          <span className={styles.sparkEmpty}>collecting…</span>
        )
      ) : (
        <span className={styles.sparkEmpty} />
      )}
      <span className={styles.srOnly}>{summary}</span>
    </div>
  );
}
