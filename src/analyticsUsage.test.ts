import { describe, expect, it } from "vitest";
import { buildUsageView, chooseClubTeam, chooseMatchReference, groupHeroMatches, matchLinkScore, normalizeAnalyticsText, placementLabel, stageRank, tournamentInScope, usageSource } from "./analyticsUsage";
import { loadEsportsAnalytics } from "./esportsAnalyticsApi";
import current from "./esportsAnalyticsSnapshot.json";
import catalog from "./owtvTeamCatalog.json";
import { statisticsMatchSource } from "./analyticsUsage";

const payload = loadEsportsAnalytics();
const settlement = buildUsageView(payload, "settlement");
const damage = buildUsageView(payload, "damage");
const total = (rows: Array<{ usage_count: string }>) => rows.reduce((sum, row) => sum + Number(row.usage_count), 0);

describe("recorded hero statistics", () => {
  it("does not double-count unresolved cross-source references in local OWTV records", () => {
    const primary = { id: "owtv:1319" };
    const reference = { id: "official-final" };
    expect(statisticsMatchSource([reference, primary])).toEqual({ matches: [primary], localOwtv: true });
    expect(statisticsMatchSource([reference])).toEqual({ matches: [reference], localOwtv: false });
  });
  it("includes the bundled 2026 Stage 1 rows in the 2026 filter", () => {
    expect(current.mapSetHeroUsage.length).toBe(10563);
    const rows = settlement.tournamentHeroUsage.filter((row) => tournamentInScope(row.tournament_sheet, "2026"));
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((row) => row.tournament_sheet)).size).toBe(7);
    expect(tournamentInScope("Midseason Championship - OWCS 2026", "2026")).toBe(true);
    expect(tournamentInScope("2025 OWCS Stage 3 · China", "2026")).toBe(false);
    expect(tournamentInScope("Regular Season China Stage 1", "China - Stage 1", "2026-03-01T00:00:00Z")).toBe(true);
    expect(tournamentInScope("Regular Season China Stage 1", "China - Stage 1", "2025-03-01T00:00:00Z")).toBe(false);
  });

  it("keeps damage records separate from post-match settlement counts", () => {
    expect(settlement.playerHeroUsage.every((row) => usageSource(row) === "settlement")).toBe(true);
    expect(damage.playerHeroUsage.every((row) => usageSource(row) === "damage")).toBe(true);
    expect(damage.matchHeroUsage).toEqual([]);
    expect(damage.teamHeroUsage.length).toBeGreaterThan(0);
  });

  it("uses the same match-map evidence for Weibo's Symmetra total and drilldown", () => {
    const evidence = settlement.matchHeroUsage.filter((row) => row.team_name === "Weibo Gaming" && row.hero_name === "Symmetra");
    const team = settlement.teamHeroUsage.filter((row) => row.team_name === "Weibo Gaming" && row.hero_name === "Symmetra");
    expect(team).toHaveLength(1);
    expect(Number(team[0].usage_count)).toBe(total(evidence));
    expect(total(evidence.filter((row) => tournamentInScope(row.tournament_sheet, "2025")))).toBe(51);
  });

  it("deduplicates two teammates using the same hero on the same map", () => {
    const raw = current.mapSetHeroUsage.filter((row) => row.team_name === "Weibo Gaming" && row.hero_name === "Symmetra");
    const distinct = new Set(raw.map((row) => `${row.tournament_sheet}|${row.match_id}|${row.map_set_index}`));
    const displayed = settlement.tournamentTeamHeroUsage.filter((row) => row.team_name === "Weibo Gaming" && row.hero_name === "Symmetra" && tournamentInScope(row.tournament_sheet, "2026"));
    expect(total(displayed)).toBe(distinct.size);
    expect(settlement.teamHeroUsage.length).toBe(new Set(settlement.teamHeroUsage.map((row) => `${row.team_name}|${row.hero_name}`)).size);
  });

  it("filters map counts by the same tournament and year as the rankings", () => {
    const maps2025 = settlement.mapHeroUsage.filter((row) => row.hero_name === "Symmetra" && tournamentInScope(row.tournament_sheet ?? "", "2025"));
    const maps2026 = settlement.mapHeroUsage.filter((row) => row.hero_name === "Symmetra" && tournamentInScope(row.tournament_sheet ?? "", "2026"));
    expect(total(maps2025)).toBeGreaterThan(0);
    expect(total(maps2026)).toBeGreaterThan(0);
    expect(total(maps2025)).not.toBe(total(maps2026));
    const counts2026 = settlement.tournamentHeroUsage.filter((row) => row.hero_name === "Symmetra" && tournamentInScope(row.tournament_sheet, "2026"));
    expect(total(maps2026)).toBe(total(counts2026));
    expect(damage.mapHeroUsage.every((row) => Boolean(row.tournament_sheet))).toBe(true);
  });

  it("does not allocate an aggregate count across ambiguous map names", () => {
    const row = settlement.matchHeroUsage.find((item) => item.tournament_sheet.startsWith("2025 "))!;
    const ambiguous = { ...payload, mapSetHeroUsage: [], matchHeroUsage: [{ ...row, usage_count: "3", evidence_maps: ["Ilios"] }] };
    const view = buildUsageView(ambiguous, "settlement");
    expect(total(view.teamHeroUsage)).toBe(3);
    expect(view.mapHeroUsage).toEqual([]);
  });

  it("keeps Chinese search terms instead of collapsing them to an empty query", () => {
    expect(normalizeAnalyticsText("秩序之光")).toBe("秩序之光");
    expect(normalizeAnalyticsText("Lúcio")).toBe("lucio");
  });

  it("selects Quartz and Youbi's club instead of the first national-team entry", () => {
    for (const name of ["Quartz", "Youbi"]) {
      const player = catalog.players.find((row) => row.alias === name)!;
      expect(player.teamNames[0]).toBe("Saudi Arabia");
      expect(chooseClubTeam(player.teamNames, [], catalog.teams, [])).toBe("Twisted Minds");
    }
    expect(chooseClubTeam([], [], catalog.teams, [])).toBe("");
  });

  it("does not infer final placements from bracket stages or incomplete scores", () => {
    const entry = { phase: "Semi Finals", title: "Weibo Gaming vs Team CC", scoreFor: 3, scoreAgainst: 2 };
    expect(placementLabel(entry, "zh")).toBe("Semi Finals");
    expect(placementLabel({ ...entry, phase: "Quarter Finals" }, "zh")).toBe("Quarter Finals");
    expect(stageRank("Quarter Finals")).toBeLessThan(stageRank("Semi Finals"));
    expect(stageRank("Semi Finals")).toBeLessThan(stageRank("Grand Finals"));
    expect(placementLabel({ ...entry, phase: "Grand Finals", scoreAgainst: null }, "zh")).toBe("Grand Finals");
    expect(placementLabel({ ...entry, phase: "Upper Bracket Grand Final" }, "zh")).toBe("Upper Bracket Grand Final");
    expect(placementLabel({ ...entry, phase: "Grand Finals" }, "zh")).toBe("冠军");
    expect(placementLabel({ ...entry, phase: "Grand Finals", scoreAgainst: 4 }, "zh")).toBe("亚军");
  });

  it("rejects conflicting or tied rematch references rather than guessing an OWTV URL", () => {
    const query = "2025 OWCS Stage 3 China Playoffs Weibo Gaming vs Team CC";
    expect(matchLinkScore(query, "2026 China Stage 3 playoffs")).toBe(-Infinity);
    expect(matchLinkScore(query, "2025 China Stage 2 playoffs")).toBe(-Infinity);
    expect(matchLinkScore(query, "2025 China Stage 3 regular season")).toBe(-Infinity);
    const a = { searchText: "2025 China Stage 3 playoffs", links: [{ kind: "owtv", url: "https://owtv.gg/matches/first" }] };
    const b = { ...a, links: [{ kind: "owtv", url: "https://owtv.gg/matches/rematch" }] };
    expect(chooseMatchReference(query, [a, b])).toBeUndefined();
    expect(chooseMatchReference(query, [a, { ...a }])).toEqual(a);
  });

  it("renders one hero row per tournament match when both teams use the hero", () => {
    const rows = settlement.matchHeroUsage.filter((row) => row.hero_name === "Symmetra");
    const grouped = groupHeroMatches(rows);
    expect(grouped.length).toBe(new Set(rows.map((row) => `${row.tournament_sheet}|${row.match_id}`)).size);
    expect(grouped.length).toBeLessThan(rows.length);
    expect(total(grouped)).toBe(total(rows));
    expect(grouped.every((row) => row.team_name == null)).toBe(true);
  });
});
