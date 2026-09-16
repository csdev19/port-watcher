import { describe, expect, it } from "vitest";
import { filterPorts } from "./filter";
import { MOCK_PORTS } from "./mock-ports";

describe("filterPorts", () => {
  it("empty query returns everything", () => {
    expect(filterPorts(MOCK_PORTS, "")).toEqual(MOCK_PORTS);
    expect(filterPorts(MOCK_PORTS, "   ")).toEqual(MOCK_PORTS);
  });

  it("numeric query matches port by prefix", () => {
    const out = filterPorts(MOCK_PORTS, "51");
    expect(out.map((p) => p.port)).toEqual([5173]);
  });

  it("exact port match works", () => {
    expect(filterPorts(MOCK_PORTS, "3000").map((p) => p.port)).toEqual([3000]);
  });

  it("matches label case-insensitively", () => {
    expect(filterPorts(MOCK_PORTS, "postgre").map((p) => p.port)).toEqual([5432]);
    expect(filterPorts(MOCK_PORTS, "VITE").map((p) => p.port)).toEqual([5173]);
  });

  it("matches project and cwd", () => {
    expect(filterPorts(MOCK_PORTS, "niway").map((p) => p.port)).toEqual([8787]);
    expect(filterPorts(MOCK_PORTS, "laqi/panel").map((p) => p.port)).toEqual([5173]);
  });

  it("matches process name", () => {
    expect(filterPorts(MOCK_PORTS, "workerd").map((p) => p.port)).toEqual([8787]);
  });

  it("no match returns empty", () => {
    expect(filterPorts(MOCK_PORTS, "zzz-nothing")).toEqual([]);
  });
});
