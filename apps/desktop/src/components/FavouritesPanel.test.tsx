import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FavouritesPanel } from "./FavouritesPanel";
import { MOCK_PORTS } from "@/lib/mock-ports";

const noop = () => {};

function baseProps() {
  return {
    favourites: [],
    favouritesError: null,
    onClearFavouritesError: noop,
    add: vi.fn().mockReturnValue({ ok: true }),
    remove: vi.fn().mockReturnValue({ ok: true }),
    data: MOCK_PORTS,
    queryError: null,
    query: "",
    onClearQuery: noop,
    onRetry: noop,
    selectedKey: null,
    expandedKey: null,
    armedKey: null,
    onSelect: noop,
    onToggleExpand: noop,
    onRequestKill: noop,
    onDisarmKill: noop,
  };
}

describe("FavouritesPanel", () => {
  it("shows the empty state and a Watch a port trigger when nothing is saved", () => {
    render(<FavouritesPanel {...baseProps()} />);
    expect(screen.getByText("No watched ports yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: /watch a port/i })).toBeTruthy();
  });

  it("renders a saved watch with matches: heading, in-use status and its listener rows", () => {
    render(<FavouritesPanel {...baseProps()} favourites={[{ port: 3000, name: "API" }]} />);
    expect(screen.getByText(/API/)).toBeTruthy();
    expect(screen.getByText("in use")).toBeTruthy();
    expect(screen.getByText("Next.js dev")).toBeTruthy();
  });

  it("renders 'nothing listening' for a saved port with no current listener", () => {
    render(<FavouritesPanel {...baseProps()} favourites={[{ port: 9999 }]} />);
    expect(screen.getByText("nothing listening")).toBeTruthy();
  });

  it("shows 'checking…' before the first successful snapshot, not a fabricated free/in-use state", () => {
    render(
      <FavouritesPanel
        {...baseProps()}
        favourites={[{ port: 3000 }]}
        data={undefined}
        queryError={null}
      />,
    );
    expect(screen.getByText("checking…")).toBeTruthy();
    expect(screen.queryByText("nothing listening")).toBeNull();
  });

  it("shows 'status unavailable' plus a retry action when there is no data and an error", () => {
    const onRetry = vi.fn();
    render(
      <FavouritesPanel
        {...baseProps()}
        favourites={[{ port: 3000 }]}
        data={undefined}
        queryError={new Error("boom")}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText("status unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("Remove calls remove(port) and never calls onRequestKill", () => {
    const remove = vi.fn().mockReturnValue({ ok: true });
    const onRequestKill = vi.fn();
    render(
      <FavouritesPanel
        {...baseProps()}
        favourites={[{ port: 3000 }]}
        remove={remove}
        onRequestKill={onRequestKill}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /remove watched port 3000/i }));
    expect(remove).toHaveBeenCalledWith(3000);
    expect(onRequestKill).not.toHaveBeenCalled();
  });

  it("filtered-empty state (saved list nonempty, no search matches) differs from the free empty state", () => {
    render(<FavouritesPanel {...baseProps()} favourites={[{ port: 3000 }]} query="nomatch" />);
    expect(screen.getByText(/no watches match/i)).toBeTruthy();
    expect(screen.queryByText("No watched ports yet")).toBeNull();
  });

  it("opens the inline watch form (not window.prompt) and adds via it", () => {
    const promptSpy = vi.spyOn(window, "prompt");
    const add = vi.fn().mockReturnValue({ ok: true });
    render(<FavouritesPanel {...baseProps()} add={add} />);

    fireEvent.click(screen.getByRole("button", { name: /watch a port/i }));
    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "4000" } });
    fireEvent.submit(screen.getByLabelText("Port").closest("form")!);

    expect(add).toHaveBeenCalledWith("4000", "");
    expect(promptSpy).not.toHaveBeenCalled();
  });
});
