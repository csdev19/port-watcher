import { useThermalCurrent } from "@/hooks/use-thermal";
import { BAND_COPY, formatTemp } from "@/lib/thermal";
import styles from "@/app.module.css";

/** A compact `58°` beside the tabs, coloured by band. Renders nothing until
 * a reading exists or when the Mac has no sensor. */
export function ThermalChip() {
  const { data } = useThermalCurrent();
  if (!data) return null;
  const copy = BAND_COPY[data.band];
  return (
    <span
      className={styles.thermalChip}
      data-band={data.band}
      data-tooltip={copy}
      aria-label={`Temperature ${formatTemp(data.avgC)}. ${copy}`}
      role="img"
    >
      {formatTemp(data.avgC)}
    </span>
  );
}
