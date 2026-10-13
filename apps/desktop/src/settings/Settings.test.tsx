import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import Settings from "./Settings";

describe("Settings", () => {
  it("opens on General and titles the window after it", () => {
    render(<Settings />);
    expect(screen.getByRole("button", { name: "General" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(document.title).toBe("General");
  });

  it("switches section from the toolbar and retitles the window", () => {
    render(<Settings />);
    fireEvent.click(screen.getByRole("button", { name: "Permissions" }));
    expect(screen.getByRole("button", { name: "Permissions" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("button", { name: "General" }).getAttribute("aria-current")).toBeNull();
    expect(document.title).toBe("Permissions");
  });
});
