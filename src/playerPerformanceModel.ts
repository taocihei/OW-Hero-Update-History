export const performanceMetrics = ["eliminations", "assists", "deaths", "damage", "healing", "mitigation", "fantasyScore"] as const;
export type PerformanceMetric = typeof performanceMetrics[number];
export type PerformanceTotals = Record<PerformanceMetric, number | null>;
export type MetricMapCounts = Record<PerformanceMetric, number>;
export type PerformanceSource = "owtv" | "statslab" | "community2025";

export interface OwtvPlayerMatchPerformance extends PerformanceTotals {
  id: string;
  datetime: string;
  event: string;
  team1: string;
  team2: string;
  playerTeam?: string;
  team1Logo: string;
  team2Logo: string;
  score1: number | null;
  score2: number | null;
  url: string;
  mapCount: number;
  dataMapCount?: number;
  metricMapCounts?: MetricMapCounts;
  dataStatus?: "complete" | "partial" | "missing";
  source?: string;
  season?: number;
}

export function identity(value: string) {
  // Match Rust's char::is_alphanumeric, including alphabetic Thai vowel marks.
  return value.toLowerCase().replace(/[^\p{Alphabetic}\p{Number}]/gu, "");
}

export function playerMatchResult(row: OwtvPlayerMatchPerformance): "win" | "loss" | "draw" | "unknown" {
  const own = row.playerTeam || row.team1;
  const left = identity(own) === identity(row.team1);
  if (!left && identity(own) !== identity(row.team2)) return "unknown";
  if (row.score1 == null || row.score2 == null) return "unknown";
  if (row.score1 === row.score2) return "draw";
  return (left ? row.score1 > row.score2 : row.score2 > row.score1) ? "win" : "loss";
}

export function summarizePlayerMatches(rows: OwtvPlayerMatchPerformance[]) {
  const totals = Object.fromEntries(performanceMetrics.map((key) => [key, null])) as PerformanceTotals;
  const metricMapCounts = Object.fromEntries(performanceMetrics.map((key) => [key, 0])) as MetricMapCounts;
  let wins = 0; let losses = 0; let draws = 0; let unknownResults = 0;
  for (const row of rows) {
    const result = playerMatchResult(row);
    if (result === "win") wins++;
    else if (result === "loss") losses++;
    else if (result === "draw") draws++;
    else unknownResults++;
    for (const key of performanceMetrics) {
      const value = row[key];
      if (value != null && Number.isFinite(value)) {
        totals[key] = (totals[key] ?? 0) + value;
        metricMapCounts[key] += row.metricMapCounts?.[key] ?? row.mapCount;
      }
    }
  }
  return { totals, metricMapCounts, wins, losses, draws, unknownResults, matchCount: rows.length,
    mapCount: rows.reduce((n, row) => n + row.mapCount, 0),
    dataMapCount: rows.reduce((n, row) => n + (row.dataMapCount ?? row.mapCount), 0) };
}

export function performanceAverage(summary: ReturnType<typeof summarizePlayerMatches>, key: PerformanceMetric) {
  const count = summary.metricMapCounts[key];
  return summary.totals[key] == null || count === 0 ? null : summary.totals[key] / count;
}

export function displayMatchDate(row: Pick<OwtvPlayerMatchPerformance, "datetime" | "season">, locale = "zh-CN") {
  const time = row.datetime ? new Date(row.datetime) : null;
  return time && Number.isFinite(time.getTime())
    ? new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit" }).format(time)
    : locale.startsWith("zh") ? `${row.season ? `${row.season} · ` : ""}日期未提供` : `${row.season ? `${row.season} · ` : ""}Date unavailable`;
}

export function canonicalEvent(event: string, aliases: Array<{ event: string; eventAliases: string[] }>) {
  const key = identity(event);
  return aliases.find((item) => [item.event, ...item.eventAliases].some((alias) => identity(alias) === key))?.event ?? event;
}
