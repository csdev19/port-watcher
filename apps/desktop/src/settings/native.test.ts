import { afterEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ order: [] as string[], refuse: false }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: unknown) => {
    calls.order.push(`invoke:${cmd}:${JSON.stringify(args)}`);
    if (calls.refuse) throw new Error("refused");
  }),
}));
vi.mock("@tauri-apps/plugin-autostart", () => ({
  enable: vi.fn(),
  disable: vi.fn(),
  isEnabled: vi.fn(),
}));
vi.mock("../lib/ports", () => ({ inTauri: true }));
vi.mock("./store", () => ({
  setSetting: vi.fn(async (key: string, value: unknown) => {
    calls.order.push(`save:${key}:${JSON.stringify(value)}`);
  }),
}));

import { setAlertRuleEnabled } from "./native";

afterEach(() => {
  calls.order.length = 0;
  calls.refuse = false;
});

describe("setAlertRuleEnabled", () => {
  it("applies the change in Rust first, then saves the setting", async () => {
    await setAlertRuleEnabled("cpuSustained", true);
    expect(calls.order).toEqual([
      'invoke:set_alert_rule_enabled:{"rule":"cpuSustained","enabled":true}',
      "save:alertCpuSustained:true",
    ]);
  });

  it("saves nothing when Rust refuses", async () => {
    calls.refuse = true;
    await expect(setAlertRuleEnabled("hotspot", false)).rejects.toThrow("refused");
    expect(calls.order.filter((c) => c.startsWith("save"))).toEqual([]);
  });
});
