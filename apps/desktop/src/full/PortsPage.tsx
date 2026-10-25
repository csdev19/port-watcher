import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePorts } from "@/hooks/use-ports";
import { useKillConfirm } from "@/hooks/use-kill-confirm";
import { useFavourites } from "@/hooks/use-favourites";
import { useSetting } from "@/settings/store";
import { filterPorts } from "@/lib/filter";
import { partitionPorts } from "@/lib/port-groups";
import { killPort } from "@/lib/ports";
import { portKey, type PortEntry } from "@/lib/types";
import { PortList } from "@/components/PortList";
import { SearchInput } from "@/components/SearchInput";
import { EmptyState, ErrorState, FilteredEmptyState } from "@/components/PanelStates";
import type { ToastData } from "@/components/Toast";
import styles from "./full.module.css";

interface Props {
  onToast: (toast: ToastData) => void;
}

/** The panel's Ports list at full width. It reuses `PortList`, the filter and the same
 * two-step kill; no port logic lives here. Favourites stay in the panel. */
export function PortsPage({ onToast }: Props) {
  const queryClient = useQueryClient();
  const { data: allPorts, error, refetch } = usePorts();
  const [confirmBeforeKill] = useSetting("confirmBeforeKill");
  const [showAppsAndSystem] = useSetting("showAppsAndSystem");
  const favourites = useFavourites();
  const favouritePorts = useMemo(
    () => new Set(favourites.items.map((f) => f.port)),
    [favourites.items],
  );
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [killingKey, setKillingKey] = useState<string | null>(null);
  const [secondaryOpen, setSecondaryOpen] = useState(false);

  const data = useMemo(
    () => (showAppsAndSystem ? allPorts : allPorts?.filter((e) => e.category === "dev")),
    [allPorts, showAppsAndSystem],
  );
  const filtered = useMemo(() => filterPorts(data ?? [], query), [data, query]);
  const groups = useMemo(() => partitionPorts(filtered), [filtered]);
  const secondaryTotal = useMemo(() => partitionPorts(data ?? []).secondary.length, [data]);
  const forcedOpen = query.trim() !== "" && groups.secondary.length > 0;

  async function handleKill(entry: PortEntry) {
    setKillingKey(portKey(entry));
    try {
      const result = await killPort(entry);
      const what = `${entry.label} (${entry.port})`;
      if (result === "terminated" || result === "killed") {
        onToast({ message: `${what} stopped`, command: entry.command });
      } else if (result === "alreadyGone") {
        onToast({ message: `${what} was already gone`, command: null });
      } else {
        onToast({ message: `Cannot kill ${what}`, command: null });
      }
      void queryClient.invalidateQueries({ queryKey: ["ports"] });
    } catch (err) {
      onToast({
        message: `Could not kill ${entry.label}: ${String(err)}`,
        command: null,
      });
    } finally {
      setKillingKey(null);
    }
  }

  const confirm = useKillConfirm(
    (entry) => {
      // Act only on the live entry the user armed (same incarnation, still killable).
      const current = (allPorts ?? []).find((e) => portKey(e) === portKey(entry));
      if (!current || !current.killable || current.startedAt !== entry.startedAt) return;
      void handleKill(current);
    },
    { confirmBeforeKill },
  );

  function toggleWatch(entry: PortEntry) {
    const result = favouritePorts.has(entry.port)
      ? favourites.remove(entry.port)
      : favourites.add(String(entry.port));
    if (!result.ok) onToast({ message: result.message, command: null });
  }

  return (
    <div className={styles.portsPage}>
      <SearchInput value={query} onChange={setQuery} />
      {error && !data ? (
        <ErrorState message={String(error)} onRetry={() => void refetch()} />
      ) : filtered.length > 0 ? (
        <PortList
          groups={groups}
          secondaryTotal={secondaryTotal}
          searching={query.trim() !== ""}
          secondaryOpen={secondaryOpen || forcedOpen}
          secondaryForcedOpen={forcedOpen}
          selectedKey={selectedKey}
          expandedKey={expandedKey}
          armedKey={confirm.armedTarget?.key ?? null}
          killingKey={killingKey}
          favouritePorts={favouritePorts}
          onSelect={setSelectedKey}
          onToggleExpand={(k) => setExpandedKey((prev) => (prev === k ? null : k))}
          onRequestKill={(entry) => confirm.request(entry, "pointer")}
          onDisarmKill={confirm.disarm}
          onToggleSecondary={() => setSecondaryOpen((v) => !v)}
          onToggleWatch={toggleWatch}
        />
      ) : query.trim() !== "" ? (
        <FilteredEmptyState query={query} onClear={() => setQuery("")} />
      ) : (
        <EmptyState />
      )}
    </div>
  );
}
