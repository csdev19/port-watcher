import { useQuery } from "@tanstack/react-query";
import { machineSnapshot } from "@/lib/machine";

/** 1 Hz, fixed (not the Ports refresh setting), and only while `enabled` (the Machine tab is
 * open) and the panel is visible: a hidden webview reports `document.hidden`, which stops the
 * refetch. Nothing samples with the panel closed. */
export function useMachine(enabled: boolean) {
  return useQuery({
    queryKey: ["machine"],
    queryFn: machineSnapshot,
    refetchInterval: 1000,
    refetchIntervalInBackground: false,
    enabled,
  });
}
