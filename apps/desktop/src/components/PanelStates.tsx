import { Icon } from "@/components/Icon";
import styles from "@/app.module.css";

export function EmptyState({ user }: { user?: string }) {
  return (
    <div className={styles.state}>
      <Icon name="circle-check" size={24} />
      <p className={styles.stateTitle}>All ports free</p>
      <p className={styles.stateSub}>Nothing is listening{user ? ` as ${user}` : ""}.</p>
    </div>
  );
}

export function FilteredEmptyState({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <div className={styles.state}>
      <Icon name="search-x" size={24} />
      <p className={styles.stateTitle}>No port matches {query}</p>
      <button type="button" className={styles.stateButton} onClick={onClear}>
        <Icon name="x" />
        Clear search
      </button>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className={styles.state}>
      <Icon name="triangle-alert" size={24} />
      <p className={styles.stateTitle}>Couldn't read the port table</p>
      <p className={styles.stateSub}>{message}</p>
      <button type="button" className={styles.stateButton} onClick={onRetry}>
        <Icon name="rotate-ccw" />
        Retry
      </button>
    </div>
  );
}
