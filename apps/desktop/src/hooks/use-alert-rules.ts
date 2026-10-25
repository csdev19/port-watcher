import { useCallback, useEffect, useState } from "react";
import { ALERTS_CHANGED_EVENT, listAlertRules, listenTo, type AlertRule } from "@/lib/alerts";

/** Every alert rule with its switch and whether it fires now: one read when the window opens,
 * then a re-read on each `alerts-changed` event (that is when a `firing` flag can change).
 * `patch` applies a switch change that Rust already accepted, without waiting for a re-read. */
export function useAlertRules() {
  const [rules, setRules] = useState<AlertRule[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      listAlertRules().then(
        (next) => {
          if (alive) setRules(next);
        },
        () => {},
      );
    void load();
    const unlisten = listenTo(ALERTS_CHANGED_EVENT, () => void load());
    return () => {
      alive = false;
      unlisten();
    };
  }, []);

  const patch = useCallback((id: AlertRule["id"], enabled: boolean) => {
    setRules((current) => current.map((r) => (r.id === id ? { ...r, enabled } : r)));
  }, []);

  return { rules, patch };
}
