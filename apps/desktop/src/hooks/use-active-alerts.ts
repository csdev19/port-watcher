import { useEffect, useState } from "react";
import { ALERTS_CHANGED_EVENT, getActiveAlerts, listenTo, type ActiveAlert } from "@/lib/alerts";

/** What is firing now: one read when the window opens, then every `alerts-changed` event. */
export function useActiveAlerts(): ActiveAlert[] {
  const [alerts, setAlerts] = useState<ActiveAlert[]>([]);

  useEffect(() => {
    let alive = true;
    // An event that lands before the first read finishes is newer than that read.
    let heard = false;
    getActiveAlerts().then(
      (initial) => {
        if (alive && !heard) setAlerts(initial);
      },
      () => {},
    );
    const unlisten = listenTo<ActiveAlert[]>(ALERTS_CHANGED_EVENT, (next) => {
      heard = true;
      if (alive) setAlerts(next);
    });
    return () => {
      alive = false;
      unlisten();
    };
  }, []);

  return alerts;
}
