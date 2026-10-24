import styles from "@/app.module.css";

interface Props {
  status: string;
  onOpenSettings: () => void;
  onQuit: () => void;
  /** Version of a downloaded-but-not-installed update, if any: adds the dot
   * and the longer accessible name. */
  pendingUpdateVersion: string | null;
}

/** `Settings · <status> · Quit`. Settings keeps the update dot and the
 * accessible name `Settings` / `Settings (chapay X is available)`. No
 * `title`: a native tooltip makes WKWebView flicker the transparent panel. */
export function PanelFooter({ status, onOpenSettings, onQuit, pendingUpdateVersion }: Props) {
  return (
    <footer className={styles.footer}>
      <button
        type="button"
        className={styles.footerButton}
        aria-label={
          pendingUpdateVersion
            ? `Settings (chapay ${pendingUpdateVersion} is available)`
            : "Settings"
        }
        onClick={onOpenSettings}
      >
        Settings
        {pendingUpdateVersion ? (
          <span className={styles.updateDot} data-testid="update-dot" aria-hidden />
        ) : null}
      </button>
      <span className={styles.footerStatus}>{status}</span>
      <button type="button" className={styles.footerButton} onClick={onQuit}>
        Quit
      </button>
    </footer>
  );
}
