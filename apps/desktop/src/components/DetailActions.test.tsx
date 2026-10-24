import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MOCK_PORTS } from "@/lib/mock-ports";
import { DetailActions } from "./DetailActions";

const { openLocalUrl } = vi.hoisted(() => ({ openLocalUrl: vi.fn() }));
vi.mock("@/lib/ports", () => ({ openLocalUrl }));

const dev = MOCK_PORTS.find((p) => p.category === "dev")!;
const secondary = MOCK_PORTS.find((p) => p.category !== "dev")!;

describe("DetailActions", () => {
  const writeText = vi.fn();
  beforeEach(() => {
    openLocalUrl.mockReset().mockResolvedValue(undefined);
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  });

  it("opens localhost:PORT for a dev row", () => {
    render(<DetailActions entry={dev} />);
    fireEvent.click(screen.getByRole("button", { name: `localhost:${dev.port}` }));
    expect(openLocalUrl).toHaveBeenCalledWith(dev.port);
  });

  it("offers Copy port instead of Open for apps and system rows", async () => {
    render(<DetailActions entry={secondary} />);
    expect(screen.queryByRole("button", { name: /^localhost:/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Copy port" }));
    expect(writeText).toHaveBeenCalledWith(String(secondary.port));
    expect(openLocalUrl).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy());
  });

  it("copies the pid", async () => {
    render(<DetailActions entry={dev} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy pid" }));
    expect(writeText).toHaveBeenCalledWith(String(dev.pid));
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy());
  });

  it("never offers Reveal", () => {
    render(<DetailActions entry={dev} />);
    expect(screen.queryByRole("button", { name: /reveal/i })).toBeNull();
  });

  it("a click does not bubble to the row (which would collapse it)", () => {
    const onRow = vi.fn();
    render(
      <div onClick={onRow}>
        <DetailActions entry={dev} />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy pid" }));
    fireEvent.click(screen.getByRole("button", { name: `localhost:${dev.port}` }));
    expect(onRow).not.toHaveBeenCalled();
  });
});
