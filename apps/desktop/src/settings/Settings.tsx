import { useEffect, useState, type ComponentType } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Info, List, Shield, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { inTauri } from "../lib/ports";
import General from "./sections/General";
import Ports from "./sections/Ports";
import Permissions from "./sections/Permissions";
import About from "./sections/About";
import styles from "./settings.module.css";

type SectionId = "general" | "ports" | "permissions" | "about";

const SECTIONS: { id: SectionId; title: string; icon: LucideIcon; body: ComponentType }[] = [
  { id: "general", title: "General", icon: SlidersHorizontal, body: General },
  { id: "ports", title: "Ports", icon: List, body: Ports },
  { id: "permissions", title: "Permissions", icon: Shield, body: Permissions },
  { id: "about", title: "About", icon: Info, body: About },
];

/** The Settings window: a macOS-style toolbar of sections over a body.
 * The window title follows the selected section, as in System Settings. */
export default function Settings() {
  const [selected, setSelected] = useState<SectionId>(() => initialSection());
  const section = SECTIONS.find((s) => s.id === selected) ?? SECTIONS[0];
  const Body = section.body;

  useEffect(() => {
    document.title = section.title;
    if (inTauri) void getCurrentWindow().setTitle(section.title);
  }, [section.title]);

  return (
    <div className={styles.window}>
      <nav className={styles.toolbar} aria-label="Settings sections">
        {SECTIONS.map(({ id, title, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={styles.tab}
            aria-current={id === selected ? "page" : undefined}
            onClick={() => setSelected(id)}
          >
            <Icon size={18} strokeWidth={1.75} aria-hidden />
            {title}
          </button>
        ))}
      </nav>
      <main className={styles.body}>
        <Body />
      </main>
    </div>
  );
}

/** `?section=permissions` opens Settings on that section. */
function initialSection(): SectionId {
  const wanted = new URLSearchParams(window.location.search).get("section");
  return SECTIONS.some((s) => s.id === wanted) ? (wanted as SectionId) : "general";
}
