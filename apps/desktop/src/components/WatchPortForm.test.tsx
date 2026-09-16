import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WatchPortForm } from "./WatchPortForm";

describe("WatchPortForm", () => {
  it("focuses the Port field on mount", () => {
    render(<WatchPortForm add={() => ({ ok: true })} onSuccess={() => {}} onCancel={() => {}} />);
    expect(document.activeElement).toBe(screen.getByLabelText("Port"));
  });

  it("submits via Enter, calling add with the typed values and onSuccess with the parsed port", () => {
    const add = vi.fn().mockReturnValue({ ok: true });
    const onSuccess = vi.fn();
    render(<WatchPortForm add={add} onSuccess={onSuccess} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "3000" } });
    fireEvent.change(screen.getByLabelText("Name (optional)"), { target: { value: "API" } });
    fireEvent.submit(screen.getByLabelText("Port").closest("form")!);

    expect(add).toHaveBeenCalledWith("3000", "API");
    expect(onSuccess).toHaveBeenCalledWith(3000);
  });

  it("on failure stays open, shows an inline error and preserves typed values", () => {
    const add = vi.fn().mockReturnValue({ ok: false, message: "Port 3000 is already watched" });
    const onSuccess = vi.fn();
    render(<WatchPortForm add={add} onSuccess={onSuccess} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "3000" } });
    fireEvent.submit(screen.getByLabelText("Port").closest("form")!);

    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.getByText("Port 3000 is already watched")).toBeTruthy();
    expect((screen.getByLabelText("Port") as HTMLInputElement).value).toBe("3000");
    expect(screen.getByLabelText("Port").getAttribute("aria-invalid")).toBe("true");
  });

  it("Escape calls onCancel and stops propagation (does not bubble to window)", () => {
    const onCancel = vi.fn();
    const windowSpy = vi.fn();
    window.addEventListener("keydown", windowSpy);
    render(<WatchPortForm add={() => ({ ok: true })} onSuccess={() => {}} onCancel={onCancel} />);

    fireEvent.keyDown(screen.getByLabelText("Port"), { key: "Escape" });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(windowSpy).not.toHaveBeenCalled();
    window.removeEventListener("keydown", windowSpy);
  });

  it("is marked as an excluded list-shortcut scope", () => {
    render(<WatchPortForm add={() => ({ ok: true })} onSuccess={() => {}} onCancel={() => {}} />);
    expect(screen.getByLabelText("Port").closest("[data-list-shortcuts='off']")).toBeTruthy();
  });
});
