import { useRef, type ReactNode } from "react";
import styles from "@/app.module.css";

export interface TabSpec<T extends string> {
  id: T;
  label: string;
  count: ReactNode;
}

interface Props<T extends string> {
  tabs: TabSpec<T>[];
  active: T;
  onChange: (next: T) => void;
  ariaLabel: string;
}

/** Underline tabs with a mono count. Roving tabindex; Left/Right move and
 * activate (wrapping), Home/End jump to the ends. The arrow keys stop
 * propagating so they never fall through to list navigation. Each tab owns
 * the ids `tab-<id>` / `panel-<id>` the tab panels reference. */
export function Tabs<T extends string>({ tabs, active, onChange, ariaLabel }: Props<T>) {
  const refs = useRef<Partial<Record<T, HTMLButtonElement | null>>>({});

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const idx = tabs.findIndex((t) => t.id === active);
    let nextIdx: number | null = null;
    if (e.key === "ArrowRight") nextIdx = (idx + 1) % tabs.length;
    else if (e.key === "ArrowLeft") nextIdx = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") nextIdx = 0;
    else if (e.key === "End") nextIdx = tabs.length - 1;

    if (nextIdx === null) return;
    e.preventDefault();
    e.stopPropagation();
    const next = tabs[nextIdx]!.id;
    onChange(next);
    refs.current[next]?.focus();
  }

  return (
    <div className={styles.tablist} role="tablist" aria-label={ariaLabel} onKeyDown={onKeyDown}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          ref={(el) => {
            refs.current[tab.id] = el;
          }}
          type="button"
          role="tab"
          id={`tab-${tab.id}`}
          aria-selected={active === tab.id}
          aria-controls={`panel-${tab.id}`}
          tabIndex={active === tab.id ? 0 : -1}
          className={active === tab.id ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          <span className={styles.tabCount}>{tab.count}</span>
        </button>
      ))}
    </div>
  );
}
