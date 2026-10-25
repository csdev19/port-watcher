import { Activity, Bell, Settings, Wifi, type LucideIcon } from "lucide-react";
import styles from "./full.module.css";

export type PageId = "overview" | "ports" | "alerts";

interface Props {
  page: PageId;
  onPage: (page: PageId) => void;
  portCount: number | null;
  alertCount: number;
  onOpenSettings: () => void;
}

const ITEMS: { id: PageId; label: string; icon: LucideIcon }[] = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "ports", label: "Ports", icon: Wifi },
  { id: "alerts", label: "Alerts", icon: Bell },
];

/** Overview, Ports and Alerts switch the page; Settings opens the existing Settings window. */
export function Sidebar({ page, onPage, portCount, alertCount, onOpenSettings }: Props) {
  return (
    <nav className={styles.sidebar} aria-label="Full window">
      {ITEMS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          className={styles.navItem}
          aria-current={page === id ? "page" : undefined}
          onClick={() => onPage(id)}
        >
          <Icon size={15} strokeWidth={1.75} aria-hidden />
          <span>{label}</span>
          {id === "ports" && portCount !== null && (
            <span className={styles.navCount}>{portCount}</span>
          )}
          {id === "alerts" && alertCount > 0 && (
            <span className={styles.navCount} aria-label={`${alertCount} firing`}>
              {alertCount}
            </span>
          )}
        </button>
      ))}
      <button type="button" className={styles.navItem} onClick={onOpenSettings}>
        <Settings size={15} strokeWidth={1.75} aria-hidden />
        <span>Settings</span>
      </button>
    </nav>
  );
}
