import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MOCK_PORTS } from "@/lib/mock-ports";
import { PortRow } from "./PortRow";

const noop = () => {};

describe("PortRow", () => {
  it("renders port, label and project", () => {
    render(
      <PortRow
        entry={MOCK_PORTS[0]}
        selected={false}
        expanded={false}
        armed={false}
        onSelect={noop}
        onToggleExpand={noop}
        onRequestKill={noop}
        onDisarm={noop}
      />,
    );
    expect(screen.getByText("3000")).toBeTruthy();
    expect(screen.getByText("Next.js dev")).toBeTruthy();
    expect(screen.getByText(/tapuy/)).toBeTruthy();
  });

  function renderRow(entry: (typeof MOCK_PORTS)[number]) {
    render(
      <PortRow
        entry={entry}
        selected={false}
        expanded={false}
        armed={false}
        onSelect={noop}
        onToggleExpand={noop}
        onRequestKill={noop}
        onDisarm={noop}
      />,
    );
  }

  it("shows the project before the path when a cwd exists", () => {
    renderRow({ ...MOCK_PORTS[0], cwd: "~/dev/tapuy/apps/web", project: "tapuy-web" });
    expect(screen.getByText("tapuy-web · ~/dev/tapuy/apps/web")).toBeTruthy();
  });

  it("shows only the path when the project equals the folder name", () => {
    renderRow({ ...MOCK_PORTS[0], cwd: "~/dev/tapuy-web", project: "tapuy-web" });
    expect(screen.getByText("~/dev/tapuy-web")).toBeTruthy();
  });

  it("shows only the path when no project was detected", () => {
    renderRow({ ...MOCK_PORTS[0], cwd: "~/dev/tapuy/apps/web", project: null });
    expect(screen.getByText("~/dev/tapuy/apps/web")).toBeTruthy();
  });

  it("truncates the path, never the project, when the line is long", () => {
    renderRow({
      ...MOCK_PORTS[0],
      cwd: "~/dev/laqi/panel-with-a-very-long-directory-name/apps/dashboard",
      project: "laqi-panel",
    });
    const text = screen.getByText(/^laqi-panel · /).textContent ?? "";
    expect(text.startsWith("laqi-panel · ~/dev")).toBe(true);
    expect(text).toContain("…");
    expect(text.endsWith("dashboard")).toBe(true);
  });

  it("is a controlled row: clicking kill requests, it does not arm itself", () => {
    const onRequestKill = vi.fn();
    render(
      <PortRow
        entry={MOCK_PORTS[0]}
        selected={true}
        expanded={false}
        armed={false}
        onSelect={noop}
        onToggleExpand={noop}
        onRequestKill={onRequestKill}
        onDisarm={noop}
      />,
    );
    const btn = screen.getByRole("button", { name: /kill/i });
    fireEvent.click(btn);
    expect(onRequestKill).toHaveBeenCalledTimes(1);
    // Still shows the icon, not "Kill?" — arming is App's job now.
    expect(screen.queryByText("Kill?")).toBeNull();
  });

  it("shows 'Kill?' and danger styling for a dev row when armed", () => {
    render(
      <PortRow
        entry={MOCK_PORTS[0]}
        selected={true}
        expanded={false}
        armed={true}
        onSelect={noop}
        onToggleExpand={noop}
        onRequestKill={noop}
        onDisarm={noop}
      />,
    );
    expect(screen.getByText("Kill?")).toBeTruthy();
  });

  it("shows a neutral 'Kill system?' label for an armed system row", () => {
    const system = MOCK_PORTS.find((p) => p.category === "system" && p.killable)!;
    render(
      <PortRow
        entry={system}
        selected={true}
        expanded={false}
        armed={true}
        onSelect={noop}
        onToggleExpand={noop}
        onRequestKill={noop}
        onDisarm={noop}
      />,
    );
    expect(screen.getByText("Kill system?")).toBeTruthy();
  });

  it("mouse leaving the kill button disarms", () => {
    const onDisarm = vi.fn();
    render(
      <PortRow
        entry={MOCK_PORTS[0]}
        selected={true}
        expanded={false}
        armed={true}
        onSelect={noop}
        onToggleExpand={noop}
        onRequestKill={noop}
        onDisarm={onDisarm}
      />,
    );
    fireEvent.mouseLeave(screen.getByText("Kill?"));
    expect(onDisarm).toHaveBeenCalledTimes(1);
  });

  it("non-killable row shows a lock and no kill button", () => {
    const locked = MOCK_PORTS.find((p) => !p.killable)!;
    render(
      <PortRow
        entry={locked}
        selected={false}
        expanded={false}
        armed={false}
        onSelect={noop}
        onToggleExpand={noop}
        onRequestKill={noop}
        onDisarm={noop}
      />,
    );
    expect(screen.queryByRole("button", { name: /kill/i })).toBeNull();
    expect(screen.getByLabelText("Belongs to another user")).toBeTruthy();
  });

  it("expanded shows pid, memory and full command", () => {
    render(
      <PortRow
        entry={MOCK_PORTS[0]}
        selected={false}
        expanded={true}
        armed={false}
        onSelect={noop}
        onToggleExpand={noop}
        onRequestKill={noop}
        onDisarm={noop}
      />,
    );
    expect(screen.getByText(/4101/)).toBeTruthy();
    expect(screen.getByText(/210 MB/)).toBeTruthy();
    expect(screen.getByText(/next dev/)).toBeTruthy();
  });
});
