import { Icon } from "@/components/Icon";
import styles from "@/app.module.css";

export interface ToastData {
  message: string;
  command: string | null;
}

/** Design brief: the toast is the undo — it names what died and offers
 * the command to bring it back. */
export function Toast({ toast, onCopy }: { toast: ToastData; onCopy: () => void }) {
  return (
    <div className={styles.toast} role="status">
      <span>{toast.message}</span>
      {toast.command && (
        <button type="button" onClick={onCopy}>
          <Icon name="copy" size={12} />
          Copy command
        </button>
      )}
    </div>
  );
}
