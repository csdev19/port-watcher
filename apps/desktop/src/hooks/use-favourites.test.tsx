import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAVOURITES_STORAGE_KEY } from "@/lib/favourites";
import { resetFavouritesMigration } from "@/lib/favourites-migration";
import { getSetting, hasSetting, resetMemorySettings, setSetting } from "@/settings/store";
import { useFavourites } from "./use-favourites";

vi.mock("@/settings/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/settings/store")>();
  return { ...actual, setSetting: vi.fn(actual.setSetting) };
});

function reset() {
  window.localStorage.clear();
  resetMemorySettings();
  resetFavouritesMigration();
  vi.restoreAllMocks();
}

describe("useFavourites", () => {
  beforeEach(reset);
  afterEach(reset);

  it("nothing stored anywhere -> empty list, no error, nothing written", async () => {
    const { result } = renderHook(() => useFavourites());
    await waitFor(() => expect(hasSetting("favourites")).resolves.toBe(false));
    expect(result.current.items).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(setSetting).not.toHaveBeenCalled();
  });

  describe("one-time import of the old localStorage list (ADR 0013)", () => {
    it("copies a valid list into settings and leaves the old key in place", async () => {
      const legacy = JSON.stringify([{ port: 3000, name: "api" }, { port: 5173 }]);
      window.localStorage.setItem(FAVOURITES_STORAGE_KEY, legacy);
      const { result } = renderHook(() => useFavourites());
      await waitFor(() =>
        expect(result.current.items).toEqual([{ port: 3000, name: "api" }, { port: 5173 }]),
      );
      expect(await getSetting("favourites")).toEqual([{ port: 3000, name: "api" }, { port: 5173 }]);
      expect(window.localStorage.getItem(FAVOURITES_STORAGE_KEY)).toBe(legacy);
      expect(result.current.error).toBeNull();
    });

    it("runs once: a later launch never overwrites the settings list", async () => {
      window.localStorage.setItem(FAVOURITES_STORAGE_KEY, JSON.stringify([{ port: 3000 }]));
      const first = renderHook(() => useFavourites());
      await waitFor(() => expect(first.result.current.items).toEqual([{ port: 3000 }]));
      act(() => {
        first.result.current.add("4000");
      });
      first.unmount();

      // Next launch: the old key still says [3000], the settings list says [3000, 4000].
      resetFavouritesMigration();
      const second = renderHook(() => useFavourites());
      await waitFor(() => expect(second.result.current.items).toHaveLength(2));
      expect(await getSetting("favourites")).toEqual([{ port: 3000 }, { port: 4000 }]);
    });

    it("an empty settings list counts as migrated", async () => {
      await setSetting("favourites", []);
      window.localStorage.setItem(FAVOURITES_STORAGE_KEY, JSON.stringify([{ port: 3000 }]));
      const { result } = renderHook(() => useFavourites());
      await act(async () => {});
      expect(result.current.items).toEqual([]);
    });

    it("sanitizes records on import and reports a recovery error", async () => {
      window.localStorage.setItem(
        FAVOURITES_STORAGE_KEY,
        JSON.stringify([{ port: 3000 }, { port: 99999 }, { port: 8080, name: "api", junk: 1 }]),
      );
      const { result } = renderHook(() => useFavourites());
      await waitFor(() =>
        expect(result.current.items).toEqual([{ port: 3000 }, { port: 8080, name: "api" }]),
      );
      await waitFor(() => expect(result.current.error).toBe("Could not load watched ports"));
    });

    it("malformed JSON -> empty list plus an error, nothing written to settings", async () => {
      window.localStorage.setItem(FAVOURITES_STORAGE_KEY, "{not json");
      const { result } = renderHook(() => useFavourites());
      await waitFor(() => expect(result.current.error).toBe("Could not load watched ports"));
      expect(result.current.items).toEqual([]);
      expect(await hasSetting("favourites")).toBe(false);
      expect(window.localStorage.getItem(FAVOURITES_STORAGE_KEY)).toBe("{not json");
    });

    it("a blocked localStorage leaves the app usable", async () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      const { result } = renderHook(() => useFavourites());
      await act(async () => {});
      expect(result.current.items).toEqual([]);
    });
  });

  it("a malformed stored value is normalized with a recovery error", async () => {
    await setSetting("favourites", [{ port: 3000 }, { port: 0 }] as never);
    const { result } = renderHook(() => useFavourites());
    await waitFor(() => expect(result.current.items).toEqual([{ port: 3000 }]));
    expect(result.current.error).toBe("Could not load watched ports");
  });

  it("clearError resets the error without touching items", async () => {
    window.localStorage.setItem(FAVOURITES_STORAGE_KEY, "{not json");
    const { result } = renderHook(() => useFavourites());
    await waitFor(() => expect(result.current.error).not.toBeNull());
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
    expect(result.current.items).toEqual([]);
  });

  it("add validates the port and rejects invalid input", () => {
    const { result } = renderHook(() => useFavourites());
    act(() => {
      const res = result.current.add("not-a-port");
      expect(res).toEqual({ ok: false, message: "Enter a port number between 1 and 65535" });
    });
    expect(result.current.items).toEqual([]);
  });

  it("add trims/normalizes name and persists to settings, preserving insertion order", async () => {
    const { result } = renderHook(() => useFavourites());
    act(() => {
      expect(result.current.add("03000", "  api  ")).toEqual({ ok: true });
    });
    act(() => {
      expect(result.current.add("8080")).toEqual({ ok: true });
    });
    expect(result.current.items).toEqual([{ port: 3000, name: "api" }, { port: 8080 }]);
    expect(await getSetting("favourites")).toEqual([{ port: 3000, name: "api" }, { port: 8080 }]);
  });

  it("add rejects a name over 30 characters", () => {
    const { result } = renderHook(() => useFavourites());
    act(() => {
      const res = result.current.add("3000", "a".repeat(31));
      expect(res).toEqual({ ok: false, message: "Name must be 30 characters or fewer" });
    });
    expect(result.current.items).toEqual([]);
  });

  it("add omits an empty/whitespace-only name", () => {
    const { result } = renderHook(() => useFavourites());
    act(() => {
      expect(result.current.add("3000", "   ")).toEqual({ ok: true });
    });
    expect(result.current.items).toEqual([{ port: 3000 }]);
  });

  it("duplicate port add is rejected with the exact contract message and does not rename", () => {
    const { result } = renderHook(() => useFavourites());
    act(() => {
      result.current.add("3000", "first");
    });
    act(() => {
      const res = result.current.add("3000", "second");
      expect(res).toEqual({ ok: false, message: "Port 3000 is already watched" });
    });
    expect(result.current.items).toEqual([{ port: 3000, name: "first" }]);
  });

  it("back-to-back adds within the same tick both land (ref stays current)", () => {
    const { result } = renderHook(() => useFavourites());
    act(() => {
      result.current.add("3000");
      result.current.add("4000");
    });
    expect(result.current.items).toEqual([{ port: 3000 }, { port: 4000 }]);
  });

  it("remove drops the port and persists", async () => {
    const { result } = renderHook(() => useFavourites());
    act(() => {
      result.current.add("3000");
      result.current.add("4000");
    });
    act(() => {
      expect(result.current.remove(3000)).toEqual({ ok: true });
    });
    expect(result.current.items).toEqual([{ port: 4000 }]);
    expect(await getSetting("favourites")).toEqual([{ port: 4000 }]);
  });

  it("rename changes only the named record", async () => {
    const { result } = renderHook(() => useFavourites());
    act(() => {
      result.current.add("3000", "api");
      result.current.add("4000");
    });
    act(() => {
      expect(result.current.rename(3000, "web")).toEqual({ ok: true });
    });
    expect(await getSetting("favourites")).toEqual([{ port: 3000, name: "web" }, { port: 4000 }]);
  });

  it("successful remount reflects persisted state", async () => {
    const first = renderHook(() => useFavourites());
    act(() => {
      first.result.current.add("3000", "api");
    });
    first.unmount();

    const second = renderHook(() => useFavourites());
    await waitFor(() => expect(second.result.current.items).toEqual([{ port: 3000, name: "api" }]));
  });

  it("a failed save puts the previous list back and reports it", async () => {
    const { result } = renderHook(() => useFavourites());
    act(() => {
      result.current.add("3000");
    });
    vi.mocked(setSetting).mockRejectedValueOnce(new Error("disk full"));
    act(() => {
      expect(result.current.add("4000")).toEqual({ ok: true });
    });
    await waitFor(() => expect(result.current.error).toBe("Could not save watched ports"));
    // The failed add never stays on screen as if it were watched.
    expect(result.current.items).toEqual([{ port: 3000 }]);
  });

  it("shows a list written by another window", async () => {
    const { result } = renderHook(() => useFavourites());
    expect(result.current.items).toEqual([]);
    await act(async () => {
      await vi.mocked(setSetting).getMockImplementation()!("favourites", [{ port: 4321 }]);
    });
    expect(result.current.items).toEqual([{ port: 4321 }]);
  });

  it("does not write on mount", async () => {
    await setSetting("favourites", [{ port: 3000 }]);
    vi.mocked(setSetting).mockClear();
    renderHook(() => useFavourites());
    await act(async () => {});
    expect(setSetting).not.toHaveBeenCalled();
  });
});
