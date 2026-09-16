import { describe, expect, it } from "vitest";
import { partitionPorts } from "./port-groups";
import { MOCK_PORTS } from "./mock-ports";
import type { PortEntry } from "./types";

const devOnly = MOCK_PORTS.filter((e) => e.category === "dev");
const secondaryOnly = MOCK_PORTS.filter((e) => e.category !== "dev");

describe("partitionPorts", () => {
  it("splits dev from app/system, preserving input order in each group", () => {
    const { dev, secondary } = partitionPorts(MOCK_PORTS);
    expect(dev.map((e) => e.port)).toEqual([3000, 5173, 5432, 8787]);
    expect(secondary.map((e) => e.port)).toEqual([7000, 631]);
  });

  it("all-dev input yields an empty secondary group", () => {
    const { dev, secondary } = partitionPorts(devOnly);
    expect(dev).toEqual(devOnly);
    expect(secondary).toEqual([]);
  });

  it("all-secondary input yields an empty dev group", () => {
    const { dev, secondary } = partitionPorts(secondaryOnly);
    expect(dev).toEqual([]);
    expect(secondary).toEqual(secondaryOnly);
  });

  it("empty input yields two empty arrays", () => {
    expect(partitionPorts([])).toEqual({ dev: [], secondary: [] });
  });

  it("treats both app and system as secondary", () => {
    const appEntry: PortEntry = { ...MOCK_PORTS[0], category: "app" };
    const { dev, secondary } = partitionPorts([appEntry]);
    expect(dev).toEqual([]);
    expect(secondary).toEqual([appEntry]);
  });
});
