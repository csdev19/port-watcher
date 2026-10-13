import { useCallback, useEffect, useState } from "react";
import { ExternalLink, RotateCcw } from "lucide-react";
import { checkFullDiskAccess, openFullDiskAccessSettings, showSetupWindow } from "@/lib/setup";
import { Button, Group, Row, SectionHeading, Status } from "../ui";
import styles from "../settings.module.css";

/** How often Full Disk Access is re-checked while this section is on screen. */
export const RECHECK_INTERVAL_MS = 2000;

/** Real macOS permission status. chapay cannot switch a permission on
 * itself, so each row only reports the state and opens the exact pane. */
export default function Permissions() {
  // null until the first probe answers, so the row never flashes "Off".
  const [fda, setFda] = useState<boolean | null>(null);

  const recheck = useCallback(async () => {
    try {
      setFda(await checkFullDiskAccess());
    } catch {
      // A failed probe reads as "not granted"; the next tick retries.
      setFda(false);
    }
  }, []);

  // This component only mounts while the Permissions section is selected,
  // so the interval stops when the user switches section.
  useEffect(() => {
    void recheck();
    const id = setInterval(() => void recheck(), RECHECK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void recheck();
    };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [recheck]);

  const open = () => void openFullDiskAccessSettings().catch(() => {});

  return (
    <>
      <SectionHeading>macOS permissions</SectionHeading>
      <Group>
        <Row
          label="Full Disk Access"
          badge={
            fda === null ? null : <Status tone={fda ? "on" : "off"}>{fda ? "On" : "Off"}</Status>
          }
          reason="Shows the project that started each server. chapay reads working directories and package.json names, never file contents."
          control={
            fda ? (
              <Button variant="plain" icon={ExternalLink} onClick={open}>
                Manage
              </Button>
            ) : (
              <Button variant="state" icon={ExternalLink} onClick={open} disabled={fda === null}>
                Turn on
              </Button>
            )
          }
        />
      </Group>
      <div className={styles.note}>
        <p className={styles.noteText}>
          chapay never asks for your password and never runs as root. Processes owned by other users
          stay locked whatever you allow here.
        </p>
        <Button
          variant="plain"
          icon={RotateCcw}
          onClick={() => void showSetupWindow().catch(() => {})}
        >
          Show the first-run window again
        </Button>
      </div>
    </>
  );
}
