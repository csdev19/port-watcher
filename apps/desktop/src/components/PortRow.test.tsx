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
        onSelect={noop}
        onToggleExpand={noop}
        onKill={noop}
      />,
    );
    expect(screen.getByText("3000")).toBeTruthy();
    expect(screen.getByText("Next.js dev")).toBeTruthy();
    expect(screen.getByText(/tapuy/)).toBeTruthy();
  });

  it("kill needs two clicks: arm then confirm", () => {
    const onKill = vi.fn();
    render(
      <PortRow
        entry={MOCK_PORTS[0]}
        selected={true}
        expanded={false}
        onSelect={noop}
        onToggleExpand={noop}
        onKill={onKill}
      />,
    );
    const btn = screen.getByRole("button", { name: /kill/i });
    fireEvent.click(btn);
    expect(onKill).not.toHaveBeenCalled();
    expect(screen.getByText("Kill?")).toBeTruthy();
    fireEvent.click(screen.getByText("Kill?"));
    expect(onKill).toHaveBeenCalledTimes(1);
  });

  it("non-killable row shows a lock and no kill button", () => {
    const locked = MOCK_PORTS.find((p) => !p.killable)!;
    render(
      <PortRow
        entry={locked}
        selected={false}
        expanded={false}
        onSelect={noop}
        onToggleExpand={noop}
        onKill={noop}
      />,
    );
    expect(screen.queryByRole("button", { name: /kill/i })).toBeNull();
    expect(screen.getByTitle("Belongs to another user")).toBeTruthy();
  });

  it("expanded shows pid, memory and full command", () => {
    render(
      <PortRow
        entry={MOCK_PORTS[0]}
        selected={false}
        expanded={true}
        onSelect={noop}
        onToggleExpand={noop}
        onKill={noop}
      />,
    );
    expect(screen.getByText(/4101/)).toBeTruthy();
    expect(screen.getByText(/210 MB/)).toBeTruthy();
    expect(screen.getByText(/next dev/)).toBeTruthy();
  });
});
