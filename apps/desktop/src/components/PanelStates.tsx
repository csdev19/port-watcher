import styles from "@/app.module.css";

export function EmptyState() {
  return <p className={styles.state}>All ports free</p>;
}

export function FilteredEmptyState({ onClear }: { onClear: () => void }) {
  return (
    <div className={styles.state}>
      <p>No match</p>
      <button type="button" onClick={onClear}>
        Clear search
      </button>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className={styles.state}>
      <p>{message}</p>
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
