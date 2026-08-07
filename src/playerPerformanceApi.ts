import type { EsportsMatch } from "./matchTypes";
import history from "./esportsHistorySnapshot.json";
import history2025 from "./esports2025Snapshot.json";

export interface OwtvPlayerMatchPerformance {
  id: string;
  datetime: string;
  event: string;
  team1: string;
  team2: string;
  team1Logo: string;
  team2Logo: string;
  score1: number | null;
  score2: number | null;
  url: string;
  mapCount: number;
  eliminations: number;
  assists: number;
  deaths: number;
  damage: number;
  healing: number;
  mitigation: number;
  fantasyScore: number;
  season?: number;
}

export interface OwtvPlayerPerformance {
  source: string;
  player: string;
  profile: {
    alias?: string;
    name?: string;
    playerRole?: string;
    region?: string;
    nationality?: string;
    imageUrl?: string;
  } | null;
  matchCount: number;
  mapCount: number;
  totals: {
    eliminations: number;
    assists: number;
    deaths: number;
    damage: number;
    healing: number;
    mitigation: number;
    fantasyScore: number;
  };
  matches: OwtvPlayerMatchPerformance[];
  archivePath?: string;
  cachedMatchCount?: number;
  fetchedMatchCount?: number;
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

const historicalPerformanceByPlayer = (() => {
  const index = new Map<string, OwtvPlayerMatchPerformance[]>();
  for (const row of [...history.playerPerformance, ...history2025.playerPerformance]) {
    const key = normalize(row.player);
    const current = index.get(key) ?? [];
    current.push({ ...row, url: row.url || "https://public.tableau.com/app/profile/overwatchleagueofficial/viz/StatsLab-HeroUsage/OverwatchLeagueHeroUsage" } as OwtvPlayerMatchPerformance);
    index.set(key, current);
  }
  return index;
})();

interface PerformanceFetchOptions {
  syncNew?: boolean;
  maxCandidates?: number;
}

export async function fetchOwtvPlayerPerformance(player: string, team: string, matches: EsportsMatch[], options: PerformanceFetchOptions = {}) {
  const teamKey = normalize(team);
  const candidates = matches
    .filter((match) => match.owtv && match.status === "completed")
    .filter((match) => !teamKey || normalize(match.team1) === teamKey || normalize(match.team2) === teamKey)
    .sort((a, b) => b.datetime.localeCompare(a.datetime))
    .map((match) => ({
      id: match.id,
      datetime: match.datetime,
      event: match.event,
      team1: match.team1,
      team2: match.team2,
      team1Logo: match.team1Logo,
      team2Logo: match.team2Logo,
      score1: match.score1,
      score2: match.score2,
      url: match.owtv,
    }))
    .slice(0, options.syncNew ? options.maxCandidates ?? 18 : 0);
  const historical = historicalPerformanceByPlayer.get(normalize(player)) ?? [];
  let current: OwtvPlayerPerformance | null = null;
  if ("__TAURI_INTERNALS__" in window) {
    const { invoke } = await import("@tauri-apps/api/core");
    current = await invoke<OwtvPlayerPerformance>("fetch_owtv_player_performance", { playerName: player, matches: candidates });
  }
  const combined = [...(current?.matches ?? []), ...historical]
    .filter((row, index, all) => all.findIndex((item) => item.id === row.id) === index)
    .sort((a, b) => b.datetime.localeCompare(a.datetime));
  if (!combined.length && !current) return null;
  const totals = combined.reduce((sum, row) => ({
    eliminations: sum.eliminations + row.eliminations,
    assists: sum.assists + row.assists,
    deaths: sum.deaths + row.deaths,
    damage: sum.damage + row.damage,
    healing: sum.healing + row.healing,
    mitigation: sum.mitigation + row.mitigation,
    fantasyScore: sum.fantasyScore + row.fantasyScore,
  }), { eliminations: 0, assists: 0, deaths: 0, damage: 0, healing: 0, mitigation: 0, fantasyScore: 0 });
  return {
    source: historical.length ? `本地档案 ${history.firstSeason}—${history2025.lastSeason} + OWTV 增量缓存` : (current?.source ?? "OWTV 本地缓存"),
    player,
    profile: current?.profile ?? null,
    matchCount: combined.length,
    mapCount: combined.reduce((sum, row) => sum + row.mapCount, 0),
    totals,
    matches: combined,
    archivePath: current?.archivePath,
    cachedMatchCount: current?.cachedMatchCount,
    fetchedMatchCount: current?.fetchedMatchCount,
  } satisfies OwtvPlayerPerformance;
}
