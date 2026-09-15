import type { ElectronAPI } from "@electron-toolkit/preload";
import type { DesktopApi } from "../shared/types";

declare global {
  interface Window {
    electron: ElectronAPI;
    api: DesktopApi;
  }
}
