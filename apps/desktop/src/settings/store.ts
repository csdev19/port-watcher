import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { load, type Store } from "@tauri-apps/plugin-store";
import { inTauri } from "../lib/ports";

/**
 * Every setting, with its default. One JSON file (`settings.json` in the
 * app data dir, through tauri-plugin-store) is the single source of
 * truth for the panel, the Settings window and the Rust side.
 *
 * Settings save when they change: there is no Save or Apply anywhere.
 */
export const SETTINGS_DEFAULTS = {
  /** Global shortcut in tauri-plugin-global-shortcut's string form. */
  shortcut: "alt+cmd+p",
  /** First click on × arms, second kills. */
  confirmBeforeKill: true,
  /** List the Apps & System group under the dev ports. */
  showAppsAndSystem: true,
  /** Poll interval while the panel is open. */
  refreshIntervalMs: 2000,
};

export type Settings = typeof SETTINGS_DEFAULTS;
export type SettingKey = keyof Settings;

const STORE_FILE = "settings.json";

let storePromise: Promise<Store> | null = null;
function store(): Promise<Store> {
  storePromise ??= load(STORE_FILE, { defaults: SETTINGS_DEFAULTS, autoSave: true });
  return storePromise;
}

// Outside Tauri (browser dev loop, tests) settings live in memory.
const memory: Partial<Settings> = {};
const memoryListeners = new Set<(key: SettingKey) => void>();

export async function getSetting<K extends SettingKey>(key: K): Promise<Settings[K]> {
  if (!inTauri) return (memory[key] ?? SETTINGS_DEFAULTS[key]) as Settings[K];
  const value = await (await store()).get<Settings[K]>(key);
  return value ?? SETTINGS_DEFAULTS[key];
}

export async function setSetting<K extends SettingKey>(key: K, value: Settings[K]): Promise<void> {
  if (!inTauri) {
    memory[key] = value;
    for (const notify of memoryListeners) notify(key);
    return;
  }
  await (await store()).set(key, value);
}

/**
 * Calls `onChange` whenever `key` changes in any window. Listens to the
 * raw `store://change` event and matches on the file path, so a change
 * made in the Settings window reaches the panel's webview too.
 */
export function subscribeSetting<K extends SettingKey>(
  key: K,
  onChange: (value: Settings[K]) => void,
): () => void {
  if (!inTauri) {
    const listener = (changed: SettingKey) => {
      if (changed === key) onChange((memory[key] ?? SETTINGS_DEFAULTS[key]) as Settings[K]);
    };
    memoryListeners.add(listener);
    return () => memoryListeners.delete(listener);
  }
  let unlisten: (() => void) | undefined;
  let cancelled = false;
  void listen<{ path: string; key: string; value: unknown; exists: boolean }>(
    "store://change",
    (event) => {
      const { path, key: changed, value, exists } = event.payload;
      if (changed !== key || !path.endsWith(STORE_FILE)) return;
      onChange(exists ? (value as Settings[K]) : SETTINGS_DEFAULTS[key]);
    },
  ).then((fn) => {
    if (cancelled) fn();
    else unlisten = fn;
  });
  return () => {
    cancelled = true;
    unlisten?.();
  };
}

/*
 * A synchronous warm cache of each setting's last known value, so a window
 * renders with it on the first frame instead of flashing the default while
 * the store loads (e.g. the Apps & System group appearing for one tick when
 * the user turned it off). settings.json stays the source of truth: the
 * cache is overwritten by every value read from or written to the store.
 */
const CACHE_PREFIX = "chapay.settings.";

function readCache<K extends SettingKey>(key: K): Settings[K] {
  try {
    const raw = window.localStorage.getItem(CACHE_PREFIX + key);
    if (raw !== null) return JSON.parse(raw) as Settings[K];
  } catch {
    // Unreadable cache: fall back to the default.
  }
  return SETTINGS_DEFAULTS[key];
}

function writeCache<K extends SettingKey>(key: K, value: Settings[K]): void {
  try {
    window.localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value));
  } catch {
    // A full or blocked localStorage only costs the warm start.
  }
}

/** A setting as React state that saves itself when set. */
export function useSetting<K extends SettingKey>(
  key: K,
): [Settings[K], (value: Settings[K]) => void] {
  const [value, setValue] = useState<Settings[K]>(() => readCache(key));

  useEffect(() => {
    let alive = true;
    const apply = (next: Settings[K]) => {
      writeCache(key, next);
      if (alive) setValue(next);
    };
    void getSetting(key).then(apply);
    const unsubscribe = subscribeSetting(key, apply);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [key]);

  const update = (next: Settings[K]) => {
    writeCache(key, next);
    setValue(next);
    void setSetting(key, next);
  };
  return [value, update];
}

/** Test helper: forget in-memory settings between tests. */
export function resetMemorySettings(): void {
  for (const key of Object.keys(memory) as SettingKey[]) delete memory[key];
  for (const key of Object.keys(SETTINGS_DEFAULTS)) {
    try {
      window.localStorage.removeItem(CACHE_PREFIX + key);
    } catch {
      // Nothing cached.
    }
  }
}
