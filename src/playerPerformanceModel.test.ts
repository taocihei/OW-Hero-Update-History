import { describe, expect, it } from "vitest";
import { canonicalEvent, displayMatchDate, identity, performanceAverage, playerMatchResult, summarizePlayerMatches, type OwtvPlayerMatchPerformance } from "./playerPerformanceModel";

function match(patch: Partial<OwtvPlayerMatchPerformance> = {}): OwtvPlayerMatchPerformance {
  return { id: "test", datetime: "2026-08-02T11:00:00Z", event: "Midseason", team1: "Weibo Gaming", team2: "Opponent", playerTeam: "Weibo Gaming", team1Logo: "", team2Logo: "", score1: 3, score2: 1, url: "", mapCount: 2,
    eliminations: null, assists: null, deaths: null, damage: null, healing: null, mitigation: null, fantasyScore: null, ...patch };
}

describe("player statistics share one scoped match list", () => {
  it("preserves Unicode player and team identities while ignoring case and punctuation", () => {
    expect(identity("  ตะวันฉาย!! ")).toBe("ตะวันฉาย");
    expect(identity("โตแมง")).not.toBe(identity("ตะวันฉาย"));
    expect(identity(" 中国—战队！１２3 ")).toBe("中国战队１２3");
    expect(identity(" 별빛달 ")).toBe("별빛달");
    expect(identity("PainCarrÚ!")).toBe("paincarrú");
    expect(identity("Weibo Gaming / OA")).toBe("weibogamingoa");
    expect(playerMatchResult(match({ playerTeam: "乙队", team1: "甲队", team2: "乙队", score1: 3, score2: 1 }))).toBe("loss");
    expect(playerMatchResult(match({ playerTeam: "丙队", team1: "甲队", team2: "乙队" }))).toBe("unknown");
  });
  it("counts wins against the player's actual match team, including transfers and right-side teams", () => {
    const rows = [match(), match({ team1: "Twisted Minds", team2: "Weibo Gaming", score1: 3, score2: 2 }), match({ playerTeam: "Hangzhou Spark", team1: "Hangzhou Spark" }), match(), match({ score1: 0, score2: 3 })];
    expect(summarizePlayerMatches(rows)).toMatchObject({ matchCount: 5, wins: 3, losses: 2 });
    expect(playerMatchResult(match({ playerTeam: "Unrelated" }))).toBe("unknown");
  });

  it("uses known metric maps as the average denominator and keeps unknown distinct from zero", () => {
    const missing = match();
    expect(summarizePlayerMatches([missing]).totals.damage).toBeNull();
    expect(performanceAverage(summarizePlayerMatches([missing]), "damage")).toBeNull();
    const partial = match({ mapCount: 4, damage: 100, healing: 0, metricMapCounts: { damage: 1, healing: 2, eliminations: 0, assists: 0, deaths: 0, mitigation: 0, fantasyScore: 0 } });
    const summary = summarizePlayerMatches([missing, partial]);
    expect(summary.mapCount).toBe(6);
    expect(summary.totals.healing).toBe(0);
    expect(performanceAverage(summary, "damage")).toBe(100);
    expect(performanceAverage(summary, "healing")).toBe(0);
  });

  it("does not count unknown or tied scores as a loss", () => {
    expect(summarizePlayerMatches([match({ score1: null }), match({ score1: 0, score2: 0 })])).toMatchObject({ wins: 0, losses: 0, unknownResults: 1, draws: 1 });
  });

  it("handles absent 2025 dates without fabricating January 1 or throwing", () => {
    expect(displayMatchDate({ datetime: "", season: 2025 })).toBe("2025 · 日期未提供");
    expect(displayMatchDate({ datetime: "invalid" }, "en-US")).toBe("Date unavailable");
  });

  it("normalizes only explicit event aliases rather than conflating different seasons", () => {
    const aliases = [{ event: "2026 季中冠军赛", eventAliases: ["Midseason Championship - OWCS 2026"] }];
    expect(canonicalEvent("Midseason Championship - OWCS 2026", aliases)).toBe("2026 季中冠军赛");
    expect(canonicalEvent("Midseason Championship - OWCS 2025", aliases)).toBe("Midseason Championship - OWCS 2025");
  });
});
