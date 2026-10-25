import { useCallback, useEffect, useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { LivePill } from "@/components/LivePill";
import { Toast, type ToastData } from "@/components/Toast";
import { useActiveAlerts } from "@/hooks/use-active-alerts";
import { useMachine } from "@/hooks/use-machine";
import { usePorts } from "@/hooks/use-ports";
import { closeFullWindowToMini } from "@/lib/machine";
import { openSettings } from "@/lib/ports";
import { AlertsPage } from "./AlertsPage";
import { OverviewPage } from "./OverviewPage";
import { PortsPage } from "./PortsPage";
import { RightNow } from "./RightNow";
import { Sidebar, type PageId } from "./Sidebar";
import styles from "./full.module.css";

const VERDICT_WORD = { ok: "OK", watch: "Watch", stop: "Stop" } as const;

/** The full window (design 10b): title bar, sidebar, page, and the "Right now" aside on the
 * Overview. Its own webview; it samples at 1 Hz only while it exists. */
export default function FullWindow() {
  const [page, setPage] = useState<PageId>("overview");
  const [toast, setToast] = useState<ToastData | null>(null);
  const machine = useMachine(true);
  const ports = usePorts();
  const alerts = useActiveAlerts();
  const snapshot = machine.data;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.isComposing) return;
      if (e.key === "," && e.metaKey) {
        e.preventDefault();
        void openSettings();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const showToast = useCallback((t: ToastData) => setToast(t), []);

  return (
    <div className={styles.window}>
      <header className={styles.titleBar} data-tauri-drag-region>
        <BrandMark />
        {snapshot && <span className={styles.chip}>{snapshot.machine.chip}</span>}
        {snapshot && (
          <LivePill
            tone={snapshot.verdict.level}
            ariaLabel={`System health: ${VERDICT_WORD[snapshot.verdict.level]}${
              snapshot.verdict.reasons.length ? `. ${snapshot.verdict.reasons.join(". ")}` : ""
            }`}
          >
            {VERDICT_WORD[snapshot.verdict.level]}
          </LivePill>
        )}
        <span className={styles.spacer} />
        <button
          type="button"
          className={styles.miniButton}
          onClick={() => void closeFullWindowToMini()}
        >
          Mini
        </button>
      </header>
      <div className={styles.body}>
        <Sidebar
          page={page}
          onPage={setPage}
          portCount={ports.data ? ports.data.length : null}
          alertCount={alerts.length}
          onOpenSettings={() => void openSettings()}
        />
        <main className={styles.main}>
          {page === "overview" ? (
            <OverviewPage snapshot={snapshot} onToast={showToast} />
          ) : page === "alerts" ? (
            <AlertsPage alerts={alerts} onToast={showToast} />
          ) : (
            <PortsPage onToast={showToast} />
          )}
        </main>
        {page === "overview" && (
          <aside className={styles.aside}>
            <RightNow snapshot={snapshot} />
          </aside>
        )}
      </div>
      {toast && (
        <Toast
          toast={toast}
          onCopy={() => {
            if (toast.command) {
              navigator.clipboard.writeText(toast.command).catch(() =>
                setToast({
                  message: "Could not copy command",
                  command: null,
                }),
              );
            }
            setToast(null);
          }}
        />
      )}
    </div>
  );
}
