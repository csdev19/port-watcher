import { forwardRef } from "react";
import { Icon } from "@/components/Icon";
import styles from "@/app.module.css";

interface Props {
  value: string;
  onChange: (value: string) => void;
}

/** Autofocused on mount and re-focused on every panel-shown event —
 * typing a port must work the instant the panel opens (spec §4.5).
 * Plain `type="text"`, not `search`: the native WebKit search-field
 * chrome (including its own clear button) can't be restyled to match
 * the panel, so the clear affordance below is built by hand instead. */
export const SearchInput = forwardRef<HTMLInputElement, Props>(function SearchInput(
  { value, onChange },
  ref,
) {
  return (
    <div className={styles.searchWrap}>
      <Icon name="search" />
      <input
        ref={ref}
        className={styles.search}
        type="text"
        autoFocus
        placeholder="Search port, app or folder"
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        aria-label="Search port, app or folder"
      />
      {value && (
        <button
          type="button"
          className={styles.searchClear}
          aria-label="Clear search"
          onClick={() => onChange("")}
        >
          <Icon name="x" />
        </button>
      )}
    </div>
  );
});
