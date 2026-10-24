import styles from "@/app.module.css";

/** The chapay door (same open-door motif as the tray glyph) plus the
 * wordmark `chapay.` with the fuchsia dot. The frame follows the text
 * colour so it reads in both appearances; the leaf is always cyan. */
export function BrandMark() {
  return (
    <div className={styles.brand}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M7 20.5V4.5H17V20.5"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M11.4 6.6L16.4 5V20L11.4 18.4V6.6Z" fill="var(--pw-accent)" />
      </svg>
      <span className={styles.wordmark}>
        chapay
        <span className={styles.wordmarkDot} aria-hidden="true">
          .
        </span>
      </span>
    </div>
  );
}
