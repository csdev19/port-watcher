import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/*
 * The renderer side of in-app updates (ADR 0007). Rust owns the updater and
 * its state (src-tauri/src/update/); every window mirrors it through the
 * `update-status` event, so the panel banner and Settings › About always
 * agree. Only the check may run by itself; installing always needs a click.
 */

export type FailureReason = "network" | "signature" | "developerId" | "cancelled" | "other";

export type UpdateStatus =
  | { state: "disabled" }
  | { state: "idle" }
  | { state: "checking" }
  | { state: "upToDate" }
  | { state: "available"; version: string }
  | { state: "downloading"; version: string; downloaded: number; total: number | null }
  | { state: "ready"; version: string }
  | { state: "cannotInstallHere"; version: string }
  | { state: "checkFailed"; reason: FailureReason }
  | { state: "installFailed"; version: string; reason: FailureReason };

export const UPDATE_EVENT = "update-status";

/** Outside Tauri (browser dev loop, tests) there is no updater. */
const DISABLED: UpdateStatus = { state: "disabled" };

/** The version a newer chapay is waiting at, whatever step it is in. */
export function pendingVersion(status: UpdateStatus): string | null {
  return "version" in status ? status.version : null;
}

/** What went wrong with an install, in one short sentence. */
export function installFailureText(reason: FailureReason): string {
  switch (reason) {
    case "developerId":
      return "This update isn't signed by chapay's developer.";
    case "signature":
      return "The update failed its signature check.";
    case "network":
      return "Couldn't download the update.";
    case "cancelled":
      return "The update was cancelled.";
    default:
      return "Couldn't update.";
  }
}

/** "1.4 / 2.2 MB", or "1.4 MB" while the size is unknown. */
export function progressText(downloaded: number, total: number | null): string {
  const mb = (bytes: number) => (bytes / 1_000_000).toFixed(1);
  return total ? `${mb(downloaded)} / ${mb(total)} MB` : `${mb(downloaded)} MB`;
}

/** 0–100, or null while the size is unknown. */
export function progressPercent(downloaded: number, total: number | null): number | null {
  if (!total) return null;
  return Math.min(100, Math.round((downloaded / total) * 100));
}

export interface UpdateActions {
  check: () => Promise<void>;
  install: () => Promise<void>;
  restart: () => Promise<void>;
}

/** The updater's state, kept current by `update-status`, plus its actions. */
export function useUpdate(): [UpdateStatus, UpdateActions] {
  const [status, setStatus] = useState<UpdateStatus>(DISABLED);

  useEffect(() => {
    let alive = true;
    let heard = false;
    let unlisten: (() => void) | undefined;
    listen<UpdateStatus>(UPDATE_EVENT, (event) => {
      heard = true;
      if (alive) setStatus(event.payload);
    }).then(
      (fn) => {
        if (alive) unlisten = fn;
        else fn();
      },
      () => {},
    );
    // The snapshot only fills in the first frame; an event that already
    // arrived is newer than it.
    invoke<UpdateStatus>("update_status").then(
      (current) => alive && !heard && setStatus(current),
      () => {},
    );
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  // Each command also answers with the resulting status; applying it here
  // keeps the window right even if an event is missed.
  const run = async (command: string) => {
    try {
      setStatus(await invoke<UpdateStatus>(command));
    } catch {
      // Not in Tauri: nothing to update.
    }
  };

  return [
    status,
    {
      check: () => run("update_check"),
      install: () => run("update_install"),
      restart: async () => {
        await invoke("update_restart").catch(() => {});
      },
    },
  ];
}
