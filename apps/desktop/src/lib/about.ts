import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";

export const REPO_URL = "https://github.com/csdev19/port-watcher";
export const RELEASES_URL = `${REPO_URL}/releases`;

/** The release page of a desktop version (tag `desktop-v{version}`). */
export function releaseNotesUrl(version: string | null): string {
  return version ? `${RELEASES_URL}/tag/desktop-v${version}` : RELEASES_URL;
}

export interface AppInfo {
  version: string | null;
  commit: string;
  arch: string | null;
}

/** Version and CPU come from the Rust side; either is null outside Tauri. */
export async function loadAppInfo(): Promise<AppInfo> {
  const [version, arch] = await Promise.all([
    getVersion().catch(() => null),
    invoke<string>("app_arch").catch(() => null),
  ]);
  return { version, commit: __COMMIT__, arch };
}

export function openExternal(url: string): Promise<void> {
  return openUrl(url);
}
