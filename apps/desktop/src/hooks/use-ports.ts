import { useQuery } from "@tanstack/react-query";
import { listPorts } from "@/lib/ports";
import { useSetting } from "@/settings/store";

/** Polls at the `refreshIntervalMs` setting while the panel is visible;
 * zero polling in background (spec §4.2 — the hidden window reports
 * document.hidden). A change made in Settings applies live. */
export function usePorts() {
  const [refreshIntervalMs] = useSetting("refreshIntervalMs");
  return useQuery({
    queryKey: ["ports"],
    queryFn: listPorts,
    refetchInterval: refreshIntervalMs,
    refetchIntervalInBackground: false,
  });
}
