import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAVOURITES_STORAGE_KEY } from "@/lib/favourites";
import { useFavourites } from "./use-favourites";

describe("useFavourites", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("absent key -> empty list, no error", () => {
    const { result } = renderHook(() => useFavourites());
    expect(result.current.items).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("malformed JSON -> empty list plus a non-blocking error, no overwrite", () => {
    window.localStorage.setItem(FAVOURITES_STORAGE_KEY, "{not json");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const { result } = renderHook(() => useFavourites());
    expect(result.current.items).toEqual([]);
    expect(result.current.error).toBe("Could not load watched ports");
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(FAVOURITES_STORAGE_KEY)).toBe("{not json");
  });

  it("wrong root shape -> empty list plus error, no overwrite", () => {
    window.localStorage.setItem(FAVOURITES_STORAGE_KEY, JSON.stringify({ port: 3000 }));
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const { result } = renderHook(() => useFavourites());
    expect(result.current.items).toEqual([]);
    expect(result.current.error).toBe("Could not load watched ports");
    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it("mixed valid/invalid records normalize on load with a recovery error, no overwrite", () => {
    window.localStorage.setItem(
      FAVOURITES_STORAGE_KEY,
      JSON.stringify([{ port: 3000 }, { port: 99999 }, { port: 8080, name: "api", junk: 1 }]),
    );
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const { result } = renderHook(() => useFavourites());
    expect(result.current.items).toEqual([{ port: 3000 }, { port: 8080, name: "api" }]);
    expect(result.current.error).toBe("Could not load watched ports");
    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it("clearError resets the error without touching items", () => {
    window.localStorage.setItem(FAVOURITES_STORAGE_KEY, "{not json");
    const { result } = renderHook(() => useFavourites());
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

  it("add trims/normalizes name and persists, preserving insertion order", () => {
    const { result } = renderHook(() => useFavourites());
    act(() => {
      expect(result.current.add("03000", "  api  ")).toEqual({ ok: true });
    });
    act(() => {
      expect(result.current.add("8080")).toEqual({ ok: true });
    });
    expect(result.current.items).toEqual([{ port: 3000, name: "api" }, { port: 8080 }]);
    expect(JSON.parse(window.localStorage.getItem(FAVOURITES_STORAGE_KEY) ?? "[]")).toEqual([
      { port: 3000, name: "api" },
      { port: 8080 },
    ]);
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

  it("remove drops the port and persists", () => {
    const { result } = renderHook(() => useFavourites());
    act(() => {
      result.current.add("3000");
      result.current.add("4000");
    });
    act(() => {
      expect(result.current.remove(3000)).toEqual({ ok: true });
    });
    expect(result.current.items).toEqual([{ port: 4000 }]);
    expect(JSON.parse(window.localStorage.getItem(FAVOURITES_STORAGE_KEY) ?? "[]")).toEqual([
      { port: 4000 },
    ]);
  });

  it("successful remount reflects persisted state", () => {
    const first = renderHook(() => useFavourites());
    act(() => {
      first.result.current.add("3000", "api");
    });
    first.unmount();

    const second = renderHook(() => useFavourites());
    expect(second.result.current.items).toEqual([{ port: 3000, name: "api" }]);
  });

  it("getItem throwing on read leaves the app usable (empty list, error set)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = renderHook(() => useFavourites());
    expect(result.current.items).toEqual([]);
    expect(result.current.error).toBe("Could not load watched ports");
  });

  it("setItem throwing on add returns an error and keeps the previous in-memory list", () => {
    const { result } = renderHook(() => useFavourites());
    act(() => {
      result.current.add("3000");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    act(() => {
      const res = result.current.add("4000");
      expect(res).toEqual({ ok: false, message: "Could not save watched ports" });
    });
    // Previous list is unchanged; the failed add never appears as if watched.
    expect(result.current.items).toEqual([{ port: 3000 }]);
  });

  it("no writes happen on mount", () => {
    window.localStorage.setItem(FAVOURITES_STORAGE_KEY, JSON.stringify([{ port: 3000 }]));
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    renderHook(() => useFavourites());
    expect(setItemSpy).not.toHaveBeenCalled();
  });
});
