import { useEffect, useState, type FormEvent } from "react";
import { Plus, StarOff } from "lucide-react";
import { useFavourites } from "../../hooks/use-favourites";
import { joinFavourites, parsePortInput, type MutationResult } from "../../lib/favourites";
import { listPorts } from "../../lib/ports";
import type { PortEntry } from "../../lib/types";
import { useSetting } from "../store";
import { AlertRuleRow } from "../AlertRuleRow";
import { Button, Group, Row, SectionHeading, Status, Switch } from "../ui";
import styles from "./ports.module.css";

/**
 * What is listening right now, refreshed every `intervalMs` while this
 * window is visible. Failures keep the last snapshot: "in use" is a hint
 * here, not something worth an error state.
 */
function useListeners(intervalMs: number): PortEntry[] {
  const [entries, setEntries] = useState<PortEntry[]>([]);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      if (document.hidden) return;
      listPorts().then(
        (next) => alive && setEntries(next),
        () => {},
      );
    };
    refresh();
    const timer = setInterval(refresh, intervalMs);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [intervalMs]);

  return entries;
}

export default function Ports() {
  const [confirmBeforeKill, setConfirmBeforeKill] = useSetting("confirmBeforeKill");
  const [showAppsAndSystem, setShowAppsAndSystem] = useSetting("showAppsAndSystem");
  const [refreshIntervalMs] = useSetting("refreshIntervalMs");
  const favourites = useFavourites();
  const entries = useListeners(refreshIntervalMs);
  const matches = joinFavourites(favourites.items, entries);

  return (
    <>
      <SectionHeading>List</SectionHeading>
      <Group>
        <Row
          label="Confirm before kill"
          reason="First click on × asks “Kill?”. Apps always ask."
          control={
            <Switch
              label="Confirm before kill"
              checked={confirmBeforeKill}
              onChange={setConfirmBeforeKill}
            />
          }
        />
        <Row
          label="Show apps & system"
          reason="Folded under your dev ports. System rows can't be killed."
          control={
            <Switch
              label="Show apps & system"
              checked={showAppsAndSystem}
              onChange={setShowAppsAndSystem}
            />
          }
        />
        <AlertRuleRow
          rule="watchedPortTaken"
          label="Notify when a watched port is taken"
          reason="“5173 taken · Vite”. Click it to open the panel on that row. Scans every 30 s while this is on."
        />
      </Group>

      <SectionHeading>Watched ports · {favourites.items.length}</SectionHeading>
      <Group>
        {matches.map(({ favourite, listeners }) => (
          <div key={favourite.port} className={styles.watched}>
            <span className={styles.port}>{favourite.port}</span>
            {favourite.name ? (
              <span className={styles.name}>{favourite.name}</span>
            ) : (
              <span className={`${styles.name} ${styles.unnamed}`}>{listeners[0]?.label}</span>
            )}
            <Status tone={listeners.length > 0 ? "watched" : "off"}>
              {listeners.length > 0 ? "in use" : "free"}
            </Status>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={`Stop watching port ${favourite.port}`}
              onClick={() => favourites.remove(favourite.port)}
            >
              <StarOff size={14} strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        ))}
        <AddPort add={favourites.add} />
      </Group>
      <p className={styles.hint}>Rename a watched port from the Favourites tab — click its name.</p>
    </>
  );
}

function AddPort({ add }: { add: (portInput: string) => MutationResult }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const valid = parsePortInput(value) !== null;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    const result = add(value);
    if (result.ok) {
      setValue("");
      setError(null);
    } else {
      setError(result.message);
    }
  }

  return (
    <form className={styles.add} onSubmit={submit} noValidate>
      <Plus size={14} strokeWidth={1.75} aria-hidden className={styles.addIcon} />
      <input
        className={styles.input}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="Add a port, e.g. 4321"
        aria-label="Port to watch"
        aria-invalid={error ? true : undefined}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
      />
      {error ? (
        <span className={styles.error} role="alert">
          {error}
        </span>
      ) : null}
      <Button type="submit" variant="state" disabled={!valid}>
        Watch
      </Button>
    </form>
  );
}
