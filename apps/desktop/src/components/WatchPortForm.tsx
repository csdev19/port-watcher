import { useEffect, useRef, useState } from "react";
import type { MutationResult } from "@/lib/favourites";
import styles from "@/app.module.css";

interface Props {
  add: (portInput: string, nameInput?: string) => MutationResult;
  /** Called once, after a successful add, with the parsed port number —
   * the caller owns clearing the query (so a watch hidden by a filter
   * becomes visible) and focusing its trigger button. */
  onSuccess: (port: number) => void;
  onCancel: () => void;
}

const PORT_ERROR_HINT = "port-error";
const NAME_ERROR_HINT = "name-error";

/** Picks which field an `add()` failure message belongs to, without
 * duplicating `useFavourites`' validation logic — the hook is the single
 * source of truth for the message text, this just routes it to the right
 * `aria-invalid`/`aria-describedby` field. */
function fieldForMessage(message: string): "port" | "name" | null {
  if (/name/i.test(message)) return "name";
  if (/port/i.test(message)) return "port";
  return null;
}

/** F7 Slice 3: inline "Watch a port" form — never `window.prompt`. Marked
 * `data-list-shortcuts="off"` so App's global keydown handler skips it
 * entirely; arrow keys and ⌘⌫ edit the fields, never navigate/kill a row.
 * Escape is handled locally (stopPropagation) so it closes the form
 * without hiding the panel — the next Escape, outside the form, closes
 * the panel per App's usual handling. */
export function WatchPortForm({ add, onSuccess, onCancel }: Props) {
  const [portInput, setPortInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<"port" | "name" | null>(null);
  const portRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    portRef.current?.focus();
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const result = add(portInput, nameInput);
    if (!result.ok) {
      setError(result.message);
      setErrorField(fieldForMessage(result.message));
      return;
    }
    const port = Number.parseInt(portInput.trim(), 10);
    onSuccess(port);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onCancel();
    }
  }

  return (
    <form
      className={styles.watchForm}
      data-list-shortcuts="off"
      noValidate
      onSubmit={handleSubmit}
      onKeyDown={handleKeyDown}
    >
      <div className={styles.watchFormRow}>
        <div className={`${styles.watchFormField} ${styles.watchFormPort}`}>
          <label htmlFor="watch-port-input">Port</label>
          <input
            id="watch-port-input"
            ref={portRef}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={portInput}
            onChange={(e) => setPortInput(e.currentTarget.value)}
            aria-invalid={errorField === "port"}
            aria-describedby={error ? PORT_ERROR_HINT : undefined}
          />
        </div>
        <div className={`${styles.watchFormField} ${styles.watchFormName}`}>
          <label htmlFor="watch-name-input">Name (optional)</label>
          <input
            id="watch-name-input"
            type="text"
            autoComplete="off"
            value={nameInput}
            onChange={(e) => setNameInput(e.currentTarget.value)}
            aria-invalid={errorField === "name"}
            aria-describedby={error ? NAME_ERROR_HINT : undefined}
          />
        </div>
      </div>
      {error && (
        <p
          className={styles.watchFormError}
          id={errorField === "name" ? NAME_ERROR_HINT : PORT_ERROR_HINT}
          role="alert"
        >
          {error}
        </p>
      )}
      <div className={styles.watchFormActions}>
        <button type="button" className={styles.watchFormCancel} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className={styles.watchFormSubmit}>
          Add
        </button>
      </div>
    </form>
  );
}
