import { forwardRef } from "react";
import styles from "@/app.module.css";

interface Props {
  value: string;
  onChange: (value: string) => void;
}

/** Autofocused on mount and re-focused on every panel-shown event —
 * typing a port must work the instant the panel opens (spec §4.5). */
export const SearchInput = forwardRef<HTMLInputElement, Props>(function SearchInput(
  { value, onChange },
  ref,
) {
  return (
    <input
      ref={ref}
      className={styles.search}
      type="search"
      autoFocus
      placeholder="Search port, app or folder"
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      aria-label="Search port, app or folder"
    />
  );
});
