/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public base URL of the R2 bucket holding the desktop installers, no
   * trailing slash. Set by release-web.yml from the DOWNLOAD_BASE_URL
   * variable; undefined in local dev and PR validation. */
  readonly VITE_PUBLIC_DOWNLOAD_URL?: string;
}
