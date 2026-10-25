import { describe, expect, it } from "vitest";
import { joinPorts } from "./process-table";
import type { ProcessGroupDto } from "./machine-types";
import type { PortEntry } from "./types";

function group(key: string, members: [number, number][]): ProcessGroupDto {
  return {
    key,
    name: key,
    sub: "",
    cpuPct: 1,
    memBytes: 1,
    memberCount: members.length,
    target: { pid: members[0]![0], startedAt: members[0]![1] },
    targetIsMain: true,
    targetName: key,
    killable: true,
    lockReason: null,
    gpuPct: null,
    members: members.map(([pid, startedAt]) => ({ pid, startedAt })),
  };
}

function port(pid: number, startedAt: number, p: number): PortEntry {
  return {
    port: p,
    pid,
    processName: "x",
    command: "x",
    cwd: null,
    project: null,
    label: "x",
    user: null,
    startedAt,
    memoryBytes: 0,
    killable: true,
    category: "dev",
    executablePath: null,
    appBundlePath: null,
  };
}

describe("joinPorts", () => {
  it("joins by pid and start time", () => {
    const rows = joinPorts([group("a", [[10, 100]])], [port(10, 100, 3000)]);
    expect(rows[0]!.ports).toEqual([3000]);
  });

  it("a reused pid with another start time gets no ports", () => {
    const rows = joinPorts([group("a", [[10, 200]])], [port(10, 100, 3000)]);
    expect(rows[0]!.ports).toEqual([]);
  });

  it("a group takes the sorted union of its members' ports, once each", () => {
    const rows = joinPorts(
      [
        group("app", [
          [1, 5],
          [2, 5],
          [3, 5],
        ]),
      ],
      [port(2, 5, 8080), port(1, 5, 3000), port(1, 5, 3000), port(3, 6, 9999)],
    );
    expect(rows[0]!.ports).toEqual([3000, 8080]);
  });

  it("keeps every other field and rows without ports", () => {
    const g = group("a", [[10, 100]]);
    const rows = joinPorts([g], []);
    expect(rows[0]).toEqual({ ...g, ports: [] });
  });
});
