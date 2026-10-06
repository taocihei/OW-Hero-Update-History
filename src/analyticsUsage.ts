import type { EsportsAnalyticsPayload, MapHeroUsage, MatchHeroUsage, PlayerHeroUsage } from "./esportsAnalyticsApi";

export type UsageSource = "settlement" | "damage";

// Unresolved cross-source schedule entries are useful references, not extra
// matches to add to an OWTV team's win/loss record.
export function statisticsMatchSource<T extends { id: string }>(matches: T[]) {
  const indexed = matches.filter((match) => /^owtv:\d+$/.test(match.id));
  return { matches: indexed.length ? indexed : matches, localOwtv: indexed.length > 0 };
}

export function normalizeAnalyticsText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
}

const legacy2026Tournaments = new Set(["China - Stage 1", "EMEA - Stage 1", "Japan - Stage 1", "Korea - Stage 1", "North America - Stage 1", "Pacific - Stage 1", "Pre-Season Bootcamp"]);

export function tournamentInScope(name: string, scope: string, date = "") {
  if (scope === "all") return true;
  if (/^20\d{2}$/.test(scope)) {
    const year = date.match(/^(20\d{2})/)?.[1] ?? name.match(/\b(20\d{2})\b/)?.[1] ?? (legacy2026Tournaments.has(name) ? "2026" : "");
    return year === scope;
  }
  if (normalizeAnalyticsText(name) === normalizeAnalyticsText(scope)) return true;
  const identity = (text: string, fallbackYear = "") => {
    const year = text.match(/\b(20\d{2})\b/)?.[1] ?? (legacy2026Tournaments.has(text) ? "2026" : fallbackYear);
    const stage = text.match(/(?:stage\s*|\bS)(\d)/i)?.[1];
    const region = /\b(?:china|cn)\b|中国/i.test(text) ? "china"
      : /\b(?:korea|kr)\b|韩国/i.test(text) ? "korea"
      : /\b(?:japan|jp)\b|日本/i.test(text) ? "japan"
      : /\b(?:north america|na)\b|北美/i.test(text) ? "na"
      : /\bemea\b/i.test(text) ? "emea"
      : /\bpacific\b|太平洋/i.test(text) ? "pacific" : "";
    return year && stage && region ? `${year}:${region}:${stage}` : "";
  };
  const expected = identity(scope);
  return Boolean(expected && expected === identity(name, date.match(/^(20\d{2})/)?.[1]));
}

export function usageSource(row: { metric?: string; damage_verified?: boolean }): UsageSource | null {
  if (row.metric === "post_match_settlement_hero" || row.metric === "scoresheet_map_appearance") return "settlement";
  if (row.metric === "damage_positive_fallback" || row.damage_verified === true) return "damage";
  return null;
}

export function mergeSameUsage<T extends { usage_count: string }>(rows: T[], keys: (keyof T)[]): T[] {
  const result = new Map<string, T>();
  for (const row of rows) {
    const key = keys.map((field) => normalizeAnalyticsText(String(row[field] ?? ""))).join("|");
    const previous = result.get(key);
    if (previous) previous.usage_count = String(Number(previous.usage_count) + Number(row.usage_count));
    else result.set(key, { ...row });
  }
  return [...result.values()];
}

export function groupHeroMatches(rows: MatchHeroUsage[]) {
  return mergeSameUsage(rows, ["tournament_sheet", "match_id", "hero_name"]).map((row) => ({ ...row, team_name: undefined }));
}

export function buildUsageView(data: EsportsAnalyticsPayload, source: UsageSource): EsportsAnalyticsPayload {
  const belongs = (row: { metric?: string; damage_verified?: boolean }) => usageSource(row) === source;
  const players = data.playerHeroUsage.filter(belongs);
  const tournamentPlayers = data.tournamentPlayerHeroUsage.filter(belongs);
  if (source === "damage") return {
    ...data,
    overallHeroUsage: mergeSameUsage(data.overallHeroUsage.filter(belongs), ["hero_name"]),
    teamHeroUsage: mergeSameUsage(data.teamHeroUsage.filter(belongs), ["team_name", "hero_name"]),
    playerHeroUsage: mergeSameUsage(players, ["player_name", "team_name", "hero_name"]),
    tournamentHeroUsage: mergeSameUsage(data.tournamentHeroUsage.filter(belongs), ["tournament_sheet", "hero_name"]),
    tournamentTeamHeroUsage: mergeSameUsage(data.tournamentTeamHeroUsage.filter(belongs), ["tournament_sheet", "team_name", "hero_name"]),
    tournamentPlayerHeroUsage: mergeSameUsage(tournamentPlayers, ["tournament_sheet", "player_name", "team_name", "hero_name"]),
    mapHeroUsage: mergeSameUsage(data.mapHeroUsage.filter(belongs), ["tournament_sheet", "map_name", "hero_name"]),
    matchHeroUsage: [], playerHeroWinRates: [], teamHeroWinRates: [],
  };

  // Counts use one team's hero appearance on one map. Both sides remain distinct.
  const matchRows = data.matchHeroUsage.filter((row) => belongs(row) && Boolean(row.team_name));
  const roles = new Map(data.teamHeroUsage.filter(belongs).map((row) => [normalizeAnalyticsText(row.hero_name), row.role]));
  const teamRows = matchRows.map((row) => ({ team_name: row.team_name!, hero_name: row.hero_name, role: roles.get(normalizeAnalyticsText(row.hero_name)) ?? "", usage_count: row.usage_count, pick_count: row.usage_count, pick_rate: "0", metric: "post_match_settlement_hero", damage_verified: false, tournament_sheet: row.tournament_sheet }));
  const maps: MapHeroUsage[] = [];
  const coveredMatches = new Set<string>();
  const mapGrains = new Set<string>();
  const groupKey = (tournament: string, match: string, team: string, hero: string) => [tournament, match, team, hero].map(normalizeAnalyticsText).join("|");
  const validMatches = new Set(matchRows.map((row) => groupKey(row.tournament_sheet, row.match_id, row.team_name!, row.hero_name)));
  for (const row of data.mapSetHeroUsage ?? []) {
    const matchKey = groupKey(row.tournament_sheet, row.match_id, row.team_name, row.hero_name);
    if (!validMatches.has(matchKey)) continue;
    const key = `${matchKey}|${row.map_set_index}`;
    if (mapGrains.has(key)) continue;
    mapGrains.add(key);
    coveredMatches.add(matchKey);
    maps.push({ tournament_sheet: row.tournament_sheet, map_name: row.map_name, hero_name: row.hero_name, role: "", usage_count: "1", pick_count: "1", pick_rate: "0", metric: "post_match_settlement_hero" });
  }
  for (const row of matchRows) {
    if (coveredMatches.has(groupKey(row.tournament_sheet, row.match_id, row.team_name!, row.hero_name))) continue;
    const evidence = [...new Set(row.evidence_maps ?? [])];
    if (evidence.length !== Number(row.usage_count)) continue;
    for (const map of evidence) maps.push({ tournament_sheet: row.tournament_sheet, map_name: map, hero_name: row.hero_name, role: "", usage_count: "1", pick_count: "1", pick_rate: "0", metric: "post_match_settlement_hero" });
  }
  return {
    ...data,
    overallHeroUsage: mergeSameUsage(teamRows, ["hero_name"]),
    teamHeroUsage: mergeSameUsage(teamRows, ["team_name", "hero_name"]),
    playerHeroUsage: mergeSameUsage(players, ["player_name", "team_name", "hero_name"]),
    tournamentHeroUsage: mergeSameUsage(teamRows, ["tournament_sheet", "hero_name"]),
    tournamentTeamHeroUsage: mergeSameUsage(teamRows, ["tournament_sheet", "team_name", "hero_name"]),
    tournamentPlayerHeroUsage: mergeSameUsage(tournamentPlayers, ["tournament_sheet", "player_name", "team_name", "hero_name"]),
    mapHeroUsage: mergeSameUsage(maps, ["tournament_sheet", "map_name", "hero_name"]),
    matchHeroUsage: matchRows, playerHeroWinRates: [], teamHeroWinRates: [],
  };
}

export function chooseClubTeam(teamNames: string[], playerRows: PlayerHeroUsage[], teams: Array<{ name?: string | null; region?: string | null }>, matches: Array<{ team1: string; team2: string; datetime: string }>) {
  const national = new Set(teams.filter((team) => /^(owwc|world cup)$/i.test(team.region ?? "")).map((team) => normalizeAnalyticsText(team.name ?? "")));
  // Some catalog exports omit a national team's region.
  ["Saudi Arabia", "China", "South Korea", "Japan", "United States", "Canada", "France", "Great Britain", "Germany", "Finland", "Sweden", "Australia", "Mexico", "Brazil", "Spain", "Italy", "Norway", "Denmark", "Poland", "Taiwan", "Hong Kong", "Singapore", "Thailand"].forEach((name) => national.add(normalizeAnalyticsText(name)));
  const catalogClubs = teamNames.filter((name) => !national.has(normalizeAnalyticsText(name)));
  const candidates = catalogClubs.length ? catalogClubs : [...new Set(playerRows.map((row) => row.team_name))].filter((name) => !national.has(normalizeAnalyticsText(name)));
  const latest = new Map<string, string>();
  for (const match of matches) for (const name of [match.team1, match.team2]) {
    const key = normalizeAnalyticsText(name);
    if ((latest.get(key) ?? "") < match.datetime) latest.set(key, match.datetime);
  }
  return [...candidates].sort((a, b) => (latest.get(normalizeAnalyticsText(b)) ?? "").localeCompare(latest.get(normalizeAnalyticsText(a)) ?? "") || a.localeCompare(b))[0] ?? "";
}

export function stageRank(value: string) {
  const key = normalizeAnalyticsText(value);
  if (key.includes("grandfinal") || key.includes("总决赛")) return 5;
  if (key.includes("quarterfinal") || key.includes("四分之一决赛") || /\bqf\b/i.test(value)) return 2;
  if (key.includes("semifinal") || key.includes("半决赛")) return 3;
  if (key.includes("final") || key.includes("决赛")) return 4;
  if (key.includes("group") || key.includes("小组")) return 1;
  return 0;
}

export function placementLabel(entry: { phase: string; title: string; scoreFor: number | null; scoreAgainst: number | null }, locale: "zh" | "en") {
  const key = normalizeAnalyticsText(`${entry.phase} ${entry.title}`);
  const grandFinal = (key.includes("grandfinal") || key.includes("总决赛")) && !/(upper|lower|winners|losers|胜者|败者|胜组|败组)/.test(key);
  const completeScore = entry.scoreFor != null && entry.scoreAgainst != null && Number.isFinite(entry.scoreFor) && Number.isFinite(entry.scoreAgainst);
  if (grandFinal && completeScore && entry.scoreFor !== entry.scoreAgainst) {
    return entry.scoreFor! > entry.scoreAgainst! ? (locale === "zh" ? "冠军" : "Champion") : (locale === "zh" ? "亚军" : "Runner-up");
  }
  return entry.phase || (grandFinal ? (locale === "zh" ? "总决赛" : "Grand final") : (locale === "zh" ? "已收录阶段" : "Recorded stage"));
}

export function matchLinkScore(archiveText: string, candidateText: string) {
  const archive = archiveText.toLowerCase().replace(/[-_]/g, " ");
  const candidate = candidateText.toLowerCase().replace(/[-_]/g, " ");
  const year = (text: string) => text.match(/\b20\d{2}\b/)?.[0];
  const stage = (text: string) => text.match(/(?:\bstage\s*|\bs\s*|阶段\s*)(\d+)/i)?.[1];
  const phase = (text: string) => /regular\s*(season|stage)|常规赛/i.test(text) ? "regular" : /group\s*stage|小组赛/i.test(text) ? "group" : /playoff|grand\s*final|semi\s*final|quarter\s*final|季后赛|淘汰赛|总决赛/i.test(text) ? "playoffs" : "";
  const round = (text: string) => /grand\s*final|总决赛/i.test(text) ? "grand" : /quarter\s*final|四分之一/i.test(text) ? "quarter" : /semi\s*final|半决赛/i.test(text) ? "semi" : "";
  let score = 0;
  for (const [extract, weight] of [[year, 12], [stage, 10], [phase, 18], [round, 8]] as const) {
    const left = extract(archive); const right = extract(candidate);
    if (left && right && left !== right) return Number.NEGATIVE_INFINITY;
    if (left && left === right) score += weight;
  }
  for (const token of ["china", "korea", "japan", "emea", "pacific", "north america", "midseason", "world final", "grand final", "playoff", "regular", "bootcamp"]) {
    if (archive.includes(token) && candidate.includes(token)) score += 4;
  }
  return score;
}

export function chooseMatchReference<T extends { searchText: string; links: Array<{ kind: string; url: string }> }>(archiveText: string, candidates: T[]): T | undefined {
  const ranked = candidates.map((candidate) => ({ candidate, score: matchLinkScore(archiveText, candidate.searchText) })).filter((item) => item.score >= 18).sort((a, b) => b.score - a.score);
  if (!ranked.length) return undefined;
  const leaders = ranked.filter((item) => item.score === ranked[0].score);
  const identity = (item: T) => {
    const owtv = item.links.filter((link) => link.kind === "owtv").map((link) => link.url);
    return (owtv.length ? owtv : item.links.map((link) => link.url)).sort().join("|");
  };
  if (new Set(leaders.map((item) => identity(item.candidate))).size !== 1) return undefined;
  return ranked[0].candidate;
}
