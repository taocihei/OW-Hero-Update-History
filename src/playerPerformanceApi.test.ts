import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOwtvPlayerPerformance } from "./playerPerformanceApi";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

afterEach(() => { vi.unstubAllGlobals(); invoke.mockReset(); });

describe("player performance source selection", () => {
  it("asks SQLite for the person directly and does not send an 18-game candidate subset", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    const payload = { player: "Guxue", source: "OWTV", matches: [] };
    invoke.mockResolvedValue(payload);
    expect(await fetchOwtvPlayerPerformance("Guxue", "Old team", [])).toBe(payload);
    expect(invoke).toHaveBeenCalledWith("fetch_owtv_player_performance", { playerName: "Guxue" });
  });

  it("does not substitute historical numbers when OWTV cannot be read in a browser", async () => {
    vi.stubGlobal("window", {});
    expect(await fetchOwtvPlayerPerformance("Guxue", "Weibo Gaming", [])).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("keeps the explicitly selected Stats Lab history separate from OWTV", async () => {
    const result = await fetchOwtvPlayerPerformance("Guxue", "Weibo Gaming", [], { source: "statslab" });
    expect(result?.matches.length).toBeGreaterThan(0);
    expect(result?.matches.every((row) => row.source === "Stats Lab" && (row.season ?? 0) <= 2023)).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });
});
