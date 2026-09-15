import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_LOCALE, normalizeLocale } from "@monorepo-template/i18n";
import { isThemePreference, type AppSettings } from "@shared/types";

const DEFAULTS: AppSettings = { locale: DEFAULT_LOCALE, theme: "system" };

/**
 * The app's persisted preferences, as a small JSON file.
 *
 * Takes the file path instead of calling `app.getPath("userData")` itself, so the
 * store stays free of Electron and can be unit-tested against a temp directory.
 */
export class SettingsStore {
  private cache: AppSettings;

  constructor(private readonly filePath: string) {
    this.cache = this.read();
  }

  get(): AppSettings {
    return { ...this.cache };
  }

  update(patch: Partial<AppSettings>): AppSettings {
    this.cache = sanitize({ ...this.cache, ...patch });
    this.write(this.cache);
    return this.get();
  }

  private read(): AppSettings {
    if (!existsSync(this.filePath)) return { ...DEFAULTS };
    try {
      return sanitize(JSON.parse(readFileSync(this.filePath, "utf8")));
    } catch {
      // A corrupt or hand-edited file must not stop the app from launching;
      // fall back to defaults and let the next write heal it.
      return { ...DEFAULTS };
    }
  }

  private write(settings: AppSettings): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    // Write-then-rename: a crash mid-write leaves the previous file intact
    // rather than a truncated one.
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    renameSync(tmp, this.filePath);
  }
}

/** Coerce unknown persisted data into valid settings, falling back per field. */
function sanitize(raw: unknown): AppSettings {
  const value = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    locale: normalizeLocale(typeof value.locale === "string" ? value.locale : null),
    theme: isThemePreference(value.theme) ? value.theme : DEFAULTS.theme,
  };
}
