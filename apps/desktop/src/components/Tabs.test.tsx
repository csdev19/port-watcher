import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Tabs } from "@/components/Tabs";

type Id = "a" | "b" | "c";
const TABS = [
  { id: "a" as Id, label: "Alpha", count: 1 },
  { id: "b" as Id, label: "Beta", count: 2 },
  { id: "c" as Id, label: "Gamma", count: 3 },
];

function Harness({ start = "a" as Id }) {
  const [active, setActive] = useState<Id>(start);
  return <Tabs tabs={TABS} active={active} onChange={setActive} ariaLabel="Letters" />;
}

const selected = (name: RegExp) => screen.getByRole("tab", { name }).getAttribute("aria-selected");

describe("Tabs", () => {
  it("labels the tablist and exposes tab/panel ids", () => {
    render(<Harness />);
    expect(screen.getByRole("tablist", { name: "Letters" })).toBeTruthy();
    const beta = screen.getByRole("tab", { name: /beta/i });
    expect(beta.id).toBe("tab-b");
    expect(beta.getAttribute("aria-controls")).toBe("panel-b");
    expect(beta.textContent).toBe("Beta2");
  });

  it("uses a roving tabindex: only the active tab is tabbable", () => {
    render(<Harness start="b" />);
    expect(screen.getByRole("tab", { name: /alpha/i }).tabIndex).toBe(-1);
    expect(screen.getByRole("tab", { name: /beta/i }).tabIndex).toBe(0);
    expect(screen.getByRole("tab", { name: /gamma/i }).tabIndex).toBe(-1);
  });

  it("ArrowRight/ArrowLeft activate the neighbour, wrapping, and move focus", () => {
    render(<Harness />);
    const alpha = screen.getByRole("tab", { name: /alpha/i });
    alpha.focus();
    fireEvent.keyDown(alpha, { key: "ArrowRight" });
    expect(selected(/beta/i)).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: /beta/i }));

    fireEvent.keyDown(screen.getByRole("tab", { name: /beta/i }), { key: "ArrowLeft" });
    fireEvent.keyDown(screen.getByRole("tab", { name: /alpha/i }), { key: "ArrowLeft" });
    expect(selected(/gamma/i)).toBe("true");
  });

  it("Home and End jump to the first and last tab", () => {
    render(<Harness start="b" />);
    fireEvent.keyDown(screen.getByRole("tab", { name: /beta/i }), { key: "End" });
    expect(selected(/gamma/i)).toBe("true");
    fireEvent.keyDown(screen.getByRole("tab", { name: /gamma/i }), { key: "Home" });
    expect(selected(/alpha/i)).toBe("true");
  });

  it("does not let handled keys reach ancestors, and ignores other keys", () => {
    let reached = 0;
    render(
      <div onKeyDown={() => reached++}>
        <Harness />
      </div>,
    );
    const alpha = screen.getByRole("tab", { name: /alpha/i });
    fireEvent.keyDown(alpha, { key: "ArrowRight" });
    expect(reached).toBe(0);
    fireEvent.keyDown(screen.getByRole("tab", { name: /beta/i }), { key: "x" });
    expect(reached).toBe(1);
    expect(selected(/beta/i)).toBe("true");
  });

  it("clicking a tab selects it", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("tab", { name: /gamma/i }));
    expect(selected(/gamma/i)).toBe("true");
  });
});
