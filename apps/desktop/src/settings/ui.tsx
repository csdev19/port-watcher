import type { ReactNode } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import styles from "./settings.module.css";

/*
 * Building blocks for every Settings section. The rules they encode:
 * - One row = a label, a one-line reason, and the control on the right.
 * - Buttons are filled, never outlined. "primary" (fuchsia) is the one
 *   main action of a screen; "state" (cyan) changes a state; everything
 *   else is "plain" (solid plum).
 * - Switches that are on are cyan.
 */

export function SectionHeading({ children }: { children: ReactNode }) {
  return <h2 className={styles.heading}>{children}</h2>;
}

export function Group({ children }: { children: ReactNode }) {
  return <div className={styles.group}>{children}</div>;
}

export function Row({
  label,
  reason,
  badge,
  control,
}: {
  label: ReactNode;
  reason: ReactNode;
  /** Small pill after the label, e.g. a status or "v0.2". */
  badge?: ReactNode;
  control: ReactNode;
}) {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <div className={styles.rowLabel}>
          {label}
          {badge}
        </div>
        <div className={styles.rowReason}>{reason}</div>
      </div>
      <div className={styles.rowControl}>{control}</div>
    </div>
  );
}

export type ButtonVariant = "primary" | "state" | "plain";

export function Button({
  variant = "plain",
  icon: Icon,
  children,
  onClick,
  disabled,
  type = "button",
}: {
  variant?: ButtonVariant;
  icon?: LucideIcon;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      className={`${styles.button} ${styles[variant]}`}
      onClick={onClick}
      disabled={disabled}
    >
      {Icon ? <Icon size={14} strokeWidth={1.75} aria-hidden /> : null}
      {children}
    </button>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name; the row's visible label usually repeats it. */
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={styles.switch}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.switchThumb} />
    </button>
  );
}

/** A status pill: a dot plus a word, e.g. "On" / "Off" / "in use". */
export function Status({
  tone,
  children,
}: {
  tone: "on" | "off" | "watched";
  children: ReactNode;
}) {
  return (
    <span className={`${styles.status} ${styles[`status_${tone}`]}`}>
      <span className={styles.statusDot} aria-hidden />
      {children}
    </span>
  );
}

/** A muted outlined pill after a label, e.g. "v0.2" for a later feature. */
export function Pill({ children }: { children: ReactNode }) {
  return <span className={styles.pill}>{children}</span>;
}

/** Keycaps for a shortcut, e.g. ["⌥", "⌘", "P"]. */
export function Keys({ keys }: { keys: string[] }) {
  return (
    <span className={styles.keys}>
      {keys.map((key) => (
        <kbd key={key} className={styles.key}>
          {key}
        </kbd>
      ))}
    </span>
  );
}

/** A one-line note under a row, e.g. why a value was refused. Sits inside the Group. */
export function RowNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className={styles.rowNote}>
      {children}
    </p>
  );
}

/** A native select styled as a plum button with a chevron. */
export function Select<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  /** Accessible name; the row's visible label usually repeats it. */
  label: string;
}) {
  return (
    <span className={styles.select}>
      <select
        aria-label={label}
        className={styles.selectInput}
        value={String(value)}
        onChange={(event) => {
          const next = options.find((option) => String(option.value) === event.target.value);
          if (next) onChange(next.value);
        }}
      >
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown size={14} strokeWidth={1.75} aria-hidden className={styles.selectChevron} />
    </span>
  );
}
