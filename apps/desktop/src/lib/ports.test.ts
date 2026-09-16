import { describe, expect, it } from "vitest";
import { inTauri, killPort, listPorts } from "./ports";
import { MOCK_PORTS } from "./mock-ports";

// jsdom has no __TAURI_INTERNALS__, so these tests exercise exactly what a
// plain browser tab gets: the mock path.
describe("ports client outside tauri", () => {
  it("detects it is not inside tauri", () => {
    expect(inTauri).toBe(false);
  });

  it("lists the mock ports", async () => {
    await expect(listPorts()).resolves.toEqual(MOCK_PORTS);
  });

  it("mock kill resolves terminated for killable rows", async () => {
    await expect(killPort(MOCK_PORTS[0])).resolves.toBe("terminated");
  });

  it("mock kill resolves permissionDenied for non-killable rows", async () => {
    const locked = MOCK_PORTS.find((p) => !p.killable)!;
    await expect(killPort(locked)).resolves.toBe("permissionDenied");
  });
});
