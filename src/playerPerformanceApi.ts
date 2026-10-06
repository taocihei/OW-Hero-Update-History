import type { EsportsMatch } from "./matchTypes";
import history from "./esportsHistorySnapshot.json";
import history2025 from "./esports2025Snapshot.json";
import { identity, summarizePlayerMatches, type OwtvPlayerMatchPerformance, type PerformanceSource, type PerformanceTotals, type MetricMapCounts } from "./playerPerformanceModel";
export type { OwtvPlayerMatchPerformance } from "./playerPerformanceModel";

export interface OwtvPlayerPerformance {
  source: string;
  player: string;
  profile: { alias?: string; name?: string; playerRole?: string; region?: string; nationality?: string; imageUrl?: string } | null;
  matchCount: number;
  mapCount: number;
  dataMapCount?: number;
  totals: PerformanceTotals;
  metricMapCounts?: MetricMapCounts;
  matches: OwtvPlayerMatchPerformance[];
  syncedAt?: string | null;
  archivePath?: string;
  cachedMatchCount?: number;
  fetchedMatchCount?: number;
}

const historicalIndexes = new Map<PerformanceSource, Map<string, OwtvPlayerMatchPerformance[]>>();

function historicalRows(player: string, source: "statslab" | "community2025") {
  let index = historicalIndexes.get(source);
  if (!index) {
    index = new Map();
    const archive = source === "statslab" ? history : history2025;
    for (const row of archive.playerPerformance) {
      const key = identity(row.player);
      const list = index.get(key) ?? [];
      list.push({ ...row, playerTeam: row.team1, source: source === "statslab" ? "Stats Lab" : "2025 社区统计",
        url: row.url || "https://public.tableau.com/app/profile/overwatchleagueofficial/viz/StatsLab-HeroUsage/OverwatchLeagueHeroUsage",
      } as OwtvPlayerMatchPerformance);
      index.set(key, list);
    }
    historicalIndexes.set(source, index);
  }
  return [...(index.get(identity(player)) ?? [])].sort((a, b) => b.datetime.localeCompare(a.datetime) || b.id.localeCompare(a.id));
}

export async function fetchOwtvPlayerPerformance(player: string, _team: string, _matches: EsportsMatch[], options: { source?: PerformanceSource } = {}): Promise<OwtvPlayerPerformance | null> {
  const source = options.source ?? "owtv";
  if (source === "owtv") {
    if (!("__TAURI_INTERNALS__" in window)) return null;
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<OwtvPlayerPerformance>("fetch_owtv_player_performance", { playerName: player });
  }
  const matches = historicalRows(player, source);
  const summary = summarizePlayerMatches(matches);
  return {
    source: source === "statslab" ? "暴雪 Stats Lab（2018—2023）" : "2025 社区统计（Stage 1 NA / EMEA）",
    player, profile: null, ...summary, matches,
    syncedAt: source === "statslab" ? history.generatedAt : history2025.generatedAt,
  };
}
