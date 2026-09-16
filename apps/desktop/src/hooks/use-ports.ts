import { useQuery } from "@tanstack/react-query";
import { listPorts } from "@/lib/ports";

const POLL_MS = 2000;

/** 2 s polling while the panel is visible; zero polling in background
 * (spec §4.2 — the hidden window reports document.hidden). */
export function usePorts() {
  return useQuery({
    queryKey: ["ports"],
    queryFn: listPorts,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
  });
}
