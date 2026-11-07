import { useEffect, useState, type ComponentType } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Info,
  List,
  MemoryStick,
  Shield,
  SlidersHorizontal,
  Thermometer,
  type LucideIcon,
} from "lucide-react";
import { inTauri, type SettingsSection } from "../lib/ports";
import General from "./sections/General";
import Ports from "./sections/Ports";
import Thermal from "./sections/Thermal";
import Memory from "./sections/Memory";
import Permissions from "./sections/Permissions";
import About from "./sections/About";
import styles from "./settings.module.css";

const SECTIONS: { id: SettingsSection; title: string; icon: LucideIcon; body: ComponentType }[] = [
  { id: "general", title: "General", icon: SlidersHorizontal, body: General },
  { id: "ports", title: "Ports", icon: List, body: Ports },
  { id: "thermal", title: "Thermal", icon: Thermometer, body: Thermal },
  { id: "memory", title: "Memory", icon: MemoryStick, body: Memory },
  { id: "permissions", title: "Permissions", icon: Shield, body: Permissions },
  { id: "about", title: "About", icon: Info, body: About },
];

/** The Settings window: a macOS-style toolbar of sections over a body.
 * The window title follows the selected section, as in System Settings. */
export default function Settings() {
  const [selected, setSelected] = useState<SettingsSection>(() => sectionOrGeneral(urlSection()));
  const section = SECTIONS.find((s) => s.id === selected) ?? SECTIONS[0];
  const Body = section.body;

  // Rust sends `settings-section` when the panel opens a section while this
  // window is already open (src-tauri/src/settings.rs).
  useEffect(() => {
    if (!inTauri) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<string>("settings-section", (event) => {
      setSelected(sectionOrGeneral(event.payload));
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

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
function urlSection(): string | null {
  return new URLSearchParams(window.location.search).get("section");
}

function sectionOrGeneral(wanted: string | null): SettingsSection {
  return SECTIONS.some((s) => s.id === wanted) ? (wanted as SettingsSection) : "general";
}
