import { useEffect, useRef } from "react";
import { ALERT_FOCUS_EVENT, listenTo, type FocusTarget } from "@/lib/alerts";

/** Calls `onFocus` when a notification click asks the panel to land on a row. Rust emits
 * `alert-focus` right after it shows the panel. */
export function useAlertFocus(onFocus: (target: FocusTarget) => void) {
  const latest = useRef(onFocus);
  latest.current = onFocus;
  useEffect(() => listenTo<FocusTarget>(ALERT_FOCUS_EVENT, (t) => latest.current(t)), []);
}
