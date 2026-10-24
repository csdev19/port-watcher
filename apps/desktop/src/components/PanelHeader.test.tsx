import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PanelHeader } from "@/components/PanelHeader";

describe("PanelHeader", () => {
  it("shows the chapay wordmark with an aria-hidden dot", () => {
    const { container } = render(<PanelHeader count={3} />);
    expect(container.textContent).toContain("chapay.");
    expect(screen.getByText(".").getAttribute("aria-hidden")).toBe("true");
    expect(container.textContent?.toLowerCase()).not.toContain("chapa" + "q");
  });

  it("reads '3 listening' with a live tone for 3 rows", () => {
    render(<PanelHeader count={3} />);
    const pill = screen.getByText("3 listening");
    expect(pill.getAttribute("data-tone")).toBe("live");
  });

  it("is idle when nothing is listening", () => {
    render(<PanelHeader count={0} />);
    expect(screen.getByText("0 listening").getAttribute("data-tone")).toBe("idle");
  });
});
